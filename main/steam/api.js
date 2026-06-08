'use strict';

const axios = require('axios');
const { marketBucket, apiBucket } = require('./ratelimit');
const { getCachedPrice, upsertPriceCache, recordPriceSnapshot } = require('../db/queries');
const { getApiKey } = require('../storage');

const STEAM_API_BASE = 'https://api.steampowered.com';
const STEAM_MARKET_BASE = 'https://steamcommunity.com';
const CS2_APP_ID = 730;
const CS2_CONTEXT_ID = 2;

const httpClient = axios.create({
  timeout: 20000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://steamcommunity.com/',
  },
});

// ─── Player Summary ───────────────────────────────────────────────────────────

async function getPlayerSummary(steamId) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Steam API key not configured');

  await apiBucket.acquire();

  const response = await httpClient.get(`${STEAM_API_BASE}/ISteamUser/GetPlayerSummaries/v2/`, {
    params: { key: apiKey, steamids: steamId },
  });

  const players = response.data?.response?.players;
  if (!players || players.length === 0) throw new Error('Player not found');

  const p = players[0];
  return {
    steamId: p.steamid,
    personaName: p.personaname,
    avatarUrl: p.avatarfull,
    profileUrl: p.profileurl,
    communityVisibilityState: p.communityvisibilitystate,
  };
}

// ─── Inventory ────────────────────────────────────────────────────────────────

async function getInventory(steamId) {
  await apiBucket.acquire();

  const allItems = [];
  let startAssetId = null;
  let hasMore = true;

  while (hasMore) {
    const params = {
      count: 2000,
      l: 'english',
      norender: 1,
    };
    if (startAssetId) params.start_assetid = startAssetId;

    let response;
    try {
      response = await httpClient.get(
        `${STEAM_MARKET_BASE}/inventory/${steamId}/${CS2_APP_ID}/${CS2_CONTEXT_ID}`,
        { params }
      );
    } catch (err) {
      const status = err.response?.status;
      const body = err.response?.data;
      if (status === 400) {
        // Steam returns 400 when the account has no CS2 inventory (never owned the game
        // or has zero items). Treat as empty rather than a hard error.
        return allItems;
      }
      if (status === 403) throw new Error('Inventory is private. Set Steam privacy to Public: Steam → Profile → Edit → Privacy Settings.');
      if (status === 429) throw new Error('Steam rate limit hit. Wait a minute and try again.');
      throw new Error(`Steam inventory request failed (HTTP ${status ?? 'unknown'}): ${body?.error || err.message}`);
    }

    const data = response.data;
    if (!data || data.success !== 1) {
      throw new Error(data?.error || 'Steam returned an unsuccessful response');
    }

    const assets = data.assets || [];
    const descriptions = data.descriptions || [];

    // Build a lookup from classid+instanceid -> description
    const descMap = {};
    for (const desc of descriptions) {
      const key = `${desc.classid}_${desc.instanceid}`;
      descMap[key] = desc;
    }

    for (const asset of assets) {
      const key = `${asset.classid}_${asset.instanceid}`;
      const desc = descMap[key];
      if (!desc) continue;

      // Extract wear from tags
      let wear = null;
      let rarity = null;
      let rarityColor = null;
      let type = null;

      if (desc.tags) {
        for (const tag of desc.tags) {
          if (tag.category === 'Exterior') wear = tag.localized_tag_name || tag.name;
          if (tag.category === 'Rarity') {
            rarity = tag.localized_tag_name || tag.name;
            rarityColor = tag.color ? `#${tag.color}` : null;
          }
          if (tag.category === 'Type') type = tag.localized_tag_name || tag.name;
        }
      }

      allItems.push({
        assetId: asset.assetid,
        classId: asset.classid,
        instanceId: asset.instanceid,
        marketHashName: desc.market_hash_name,
        name: desc.name,
        type,
        rarity,
        rarityColor,
        wear,
        iconUrl: desc.icon_url
          ? `https://community.akamai.steamstatic.com/economy/image/${desc.icon_url}/360fx360f`
          : null,
        tradable: desc.tradable === 1,
        marketable: desc.marketable === 1,
      });
    }

    hasMore = data.more_items === 1;
    if (hasMore && data.last_assetid) {
      startAssetId = data.last_assetid;
      await apiBucket.acquire();
    } else {
      hasMore = false;
    }
  }

  return allItems;
}

// ─── Market Price ─────────────────────────────────────────────────────────────

function parsePrice(str) {
  if (!str) return null;
  // Remove currency symbols, commas, spaces — keep digits and decimal point
  const cleaned = str.replace(/[^0-9.]/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

async function getMarketPrice(marketHashName) {
  // Check cache first
  const cached = getCachedPrice(marketHashName);
  if (cached) {
    return {
      lowestPrice: cached.lowest_price,
      medianPrice: cached.median_price,
      volume: cached.volume,
      fromCache: true,
    };
  }

  await marketBucket.acquire();

  const response = await httpClient.get(`${STEAM_MARKET_BASE}/market/priceoverview/`, {
    params: {
      appid: CS2_APP_ID,
      currency: 1, // USD
      market_hash_name: marketHashName,
    },
  });

  const data = response.data;
  if (!data || !data.success) {
    throw new Error(`Price fetch failed for: ${marketHashName}`);
  }

  const result = {
    lowestPrice: data.lowest_price || null,
    medianPrice: data.median_price || null,
    volume: data.volume || null,
    fromCache: false,
  };

  // Store in cache
  upsertPriceCache({
    marketHashName,
    lowestPrice: result.lowestPrice,
    medianPrice: result.medianPrice,
    volume: result.volume,
  });

  // Record historical snapshot
  const priceUsd = parsePrice(result.lowestPrice) || parsePrice(result.medianPrice);
  if (priceUsd !== null) {
    recordPriceSnapshot({ marketHashName, priceUsd, volume: result.volume });
  }

  return result;
}

// ─── Batch Price Fetch ────────────────────────────────────────────────────────

async function batchGetMarketPrices(marketHashNames, onProgress) {
  const results = {};
  const names = [...new Set(marketHashNames)]; // deduplicate

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    try {
      results[name] = await getMarketPrice(name);
    } catch (err) {
      results[name] = { error: err.message };
    }
    if (onProgress) onProgress(i + 1, names.length);
  }

  return results;
}

// ─── Profile Resolution ───────────────────────────────────────────────────────
// Accepts any of:
//   76561198XXXXXXXXX          (SteamID64 directly)
//   steamcommunity.com/profiles/76561198XXXXXXXXX
//   steamcommunity.com/id/vanityname
//   https://... variants of the above

async function resolveProfileUrl(input) {
  const raw = (input || '').trim();
  if (!raw) throw new Error('Empty input');

  // Direct SteamID64
  if (/^\d{17}$/.test(raw)) {
    return raw;
  }

  // Extract from full URL
  const profileMatch = raw.match(/steamcommunity\.com\/profiles\/(\d{17})/);
  if (profileMatch) return profileMatch[1];

  const vanityMatch = raw.match(/steamcommunity\.com\/id\/([A-Za-z0-9_-]+)/);
  const vanityName = vanityMatch ? vanityMatch[1] : raw.replace(/^https?:\/\//i, '').replace(/\/$/, '');

  // Try resolving as vanity URL
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Steam API key required to resolve vanity URLs. Enter your key in Settings.');

  await apiBucket.acquire();

  const response = await httpClient.get(`${STEAM_API_BASE}/ISteamUser/ResolveVanityURL/v1/`, {
    params: { key: apiKey, vanityurl: vanityName },
  });

  const result = response.data?.response;
  if (!result || result.success !== 1) {
    throw new Error(`Could not resolve Steam profile: "${vanityName}". Check the URL or SteamID and try again.`);
  }

  return result.steamid;
}

module.exports = { getPlayerSummary, getInventory, getMarketPrice, batchGetMarketPrices, resolveProfileUrl };
