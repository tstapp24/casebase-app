'use strict';

const { getDatabase } = require('./database');

// ─── Users ────────────────────────────────────────────────────────────────────

function upsertUser({ steamId, personaName, avatarUrl }) {
  const db = getDatabase();
  return db.prepare(`
    INSERT INTO users (steam_id, persona_name, avatar_url, last_login)
    VALUES (?, ?, ?, strftime('%s','now'))
    ON CONFLICT(steam_id) DO UPDATE SET
      persona_name = excluded.persona_name,
      avatar_url   = excluded.avatar_url,
      last_login   = excluded.last_login
  `).run(steamId, personaName, avatarUrl);
}

function getUser(steamId) {
  return getDatabase().prepare('SELECT * FROM users WHERE steam_id = ?').get(steamId);
}

// ─── Inventory ────────────────────────────────────────────────────────────────

function upsertInventoryItems(steamId, items) {
  const db = getDatabase();
  const insert = db.prepare(`
    INSERT INTO inventory_items
      (steam_id, asset_id, class_id, instance_id, market_hash_name, name, type,
       rarity, rarity_color, wear, icon_url, tradable, marketable, last_updated)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,strftime('%s','now'))
  `);
  const deleteAll = db.prepare('DELETE FROM inventory_items WHERE steam_id = ?');

  db.exec('BEGIN');
  try {
    deleteAll.run(steamId);
    for (const item of items) {
      if (!item.marketHashName) continue;
      insert.run(
        steamId,
        item.assetId,
        item.classId,
        item.instanceId,
        item.marketHashName,
        item.name,
        item.type,
        item.rarity,
        item.rarityColor,
        item.wear,
        item.iconUrl,
        item.tradable ? 1 : 0,
        item.marketable ? 1 : 0
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function getInventory(steamId) {
  return getDatabase()
    .prepare('SELECT * FROM inventory_items WHERE steam_id = ? ORDER BY market_hash_name ASC')
    .all(steamId);
}

// ─── Price Cache ──────────────────────────────────────────────────────────────

const CACHE_TTL_SECONDS = 3600; // 60 minutes

function getCachedPrice(marketHashName) {
  const row = getDatabase()
    .prepare('SELECT * FROM price_cache WHERE market_hash_name = ?')
    .get(marketHashName);

  if (!row) return null;

  const age = Math.floor(Date.now() / 1000) - Number(row.fetched_at);
  if (age > CACHE_TTL_SECONDS) return null;

  return row;
}

function upsertPriceCache({ marketHashName, lowestPrice, medianPrice, volume }) {
  return getDatabase().prepare(`
    INSERT INTO price_cache (market_hash_name, lowest_price, median_price, volume, fetched_at)
    VALUES (?, ?, ?, ?, strftime('%s','now'))
    ON CONFLICT(market_hash_name) DO UPDATE SET
      lowest_price = excluded.lowest_price,
      median_price = excluded.median_price,
      volume       = excluded.volume,
      fetched_at   = excluded.fetched_at
  `).run(marketHashName, lowestPrice, medianPrice, volume);
}

// ─── Skinport Price Cache ─────────────────────────────────────────────────────

const SKINPORT_CACHE_TTL_SECONDS = 300; // 5 minutes

function bulkUpsertSkinportPrices(items) {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO skinport_price_cache
      (market_hash_name, min_price, suggested_price, median_price, quantity, fetched_at)
    VALUES (?, ?, ?, ?, ?, strftime('%s','now'))
    ON CONFLICT(market_hash_name) DO UPDATE SET
      min_price       = excluded.min_price,
      suggested_price = excluded.suggested_price,
      median_price    = excluded.median_price,
      quantity        = excluded.quantity,
      fetched_at      = excluded.fetched_at
  `);
  db.exec('BEGIN');
  try {
    for (const item of items) {
      stmt.run(
        item.market_hash_name,
        item.min_price ?? null,
        item.suggested_price ?? null,
        item.median_price ?? null,
        item.quantity ?? null
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function getSkinportCachedPrice(marketHashName) {
  return getDatabase()
    .prepare('SELECT * FROM skinport_price_cache WHERE market_hash_name = ?')
    .get(marketHashName) || null;
}

function getSkinportCacheAge() {
  const row = getDatabase()
    .prepare('SELECT MAX(fetched_at) AS newest FROM skinport_price_cache')
    .get();
  if (!row?.newest) return Infinity;
  return Math.floor(Date.now() / 1000) - Number(row.newest);
}

function isSkinportCacheFresh() {
  return getSkinportCacheAge() < SKINPORT_CACHE_TTL_SECONDS;
}

// ─── Price History ────────────────────────────────────────────────────────────

function recordPriceSnapshot({ marketHashName, priceUsd, volume, source = 'steam' }) {
  return getDatabase().prepare(`
    INSERT INTO price_history (market_hash_name, price_usd, volume, source, recorded_at)
    VALUES (?, ?, ?, ?, strftime('%s','now'))
  `).run(marketHashName, priceUsd, volume, source);
}

function getPriceHistory(marketHashName, limit = 90) {
  return getDatabase().prepare(`
    SELECT price_usd, volume, recorded_at
    FROM price_history
    WHERE market_hash_name = ?
    ORDER BY recorded_at ASC
    LIMIT ?
  `).all(marketHashName, limit);
}

// ─── Price Alerts ─────────────────────────────────────────────────────────────

function createAlert({ steamId, marketHashName, targetPrice, direction }) {
  return getDatabase().prepare(`
    INSERT INTO price_alerts (steam_id, market_hash_name, target_price, direction)
    VALUES (?, ?, ?, ?)
  `).run(steamId, marketHashName, targetPrice, direction);
}

function getAlerts(steamId) {
  return getDatabase()
    .prepare('SELECT * FROM price_alerts WHERE steam_id = ? ORDER BY created_at DESC')
    .all(steamId);
}

function getEnabledAlerts(steamId) {
  return getDatabase()
    .prepare('SELECT * FROM price_alerts WHERE steam_id = ? AND enabled = 1 AND triggered = 0')
    .all(steamId);
}

function markAlertTriggered(alertId) {
  return getDatabase().prepare(`
    UPDATE price_alerts SET triggered = 1, triggered_at = strftime('%s','now')
    WHERE id = ?
  `).run(alertId);
}

function deleteAlert(alertId) {
  return getDatabase().prepare('DELETE FROM price_alerts WHERE id = ?').run(alertId);
}

function toggleAlert(alertId, enabled) {
  return getDatabase()
    .prepare('UPDATE price_alerts SET enabled = ? WHERE id = ?')
    .run(enabled ? 1 : 0, alertId);
}

// ─── Tracked Profiles ─────────────────────────────────────────────────────────

function upsertTrackedProfile({ steamId, personaName, avatarUrl, profileUrl }) {
  return getDatabase().prepare(`
    INSERT INTO tracked_profiles (steam_id, persona_name, avatar_url, profile_url)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(steam_id) DO UPDATE SET
      persona_name = excluded.persona_name,
      avatar_url   = excluded.avatar_url,
      profile_url  = excluded.profile_url
  `).run(steamId, personaName, avatarUrl, profileUrl);
}

function getTrackedProfiles() {
  return getDatabase()
    .prepare('SELECT * FROM tracked_profiles ORDER BY added_at DESC')
    .all();
}

function getTrackedProfile(steamId) {
  return getDatabase()
    .prepare('SELECT * FROM tracked_profiles WHERE steam_id = ?')
    .get(steamId);
}

function deleteTrackedProfile(steamId) {
  const db = getDatabase();
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM tracked_profiles WHERE steam_id = ?').run(steamId);
    db.prepare('DELETE FROM inventory_items WHERE steam_id = ?').run(steamId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function touchProfileRefresh(steamId) {
  return getDatabase()
    .prepare(`UPDATE tracked_profiles SET last_refreshed = strftime('%s','now') WHERE steam_id = ?`)
    .run(steamId);
}

function getProfileStats(steamId) {
  const items = getDatabase()
    .prepare('SELECT * FROM inventory_items WHERE steam_id = ? AND marketable = 1')
    .all(steamId);

  let totalValue = 0;
  let topItem = null;
  let topPrice = -1;

  for (const item of items) {
    const cached = getSkinportCachedPrice(item.market_hash_name);
    if (cached?.min_price == null) continue;
    const price = cached.min_price;
    totalValue += price;
    if (price > topPrice) {
      topPrice = price;
      topItem = { name: item.name, iconUrl: item.icon_url, price };
    }
  }

  return { itemCount: items.length, totalValue, topItem };
}

function savePortfolioSnapshot({ steamId, totalValue, itemCount }) {
  getDatabase()
    .prepare('INSERT INTO portfolio_snapshots (steam_id, total_value, item_count) VALUES (?, ?, ?)')
    .run(steamId, totalValue, itemCount);
}

function getPortfolioHistory(steamId) {
  return getDatabase()
    .prepare(`
      SELECT total_value, item_count, recorded_at
      FROM portfolio_snapshots
      WHERE steam_id = ?
      ORDER BY recorded_at ASC
      LIMIT 500
    `)
    .all(steamId);
}

module.exports = {
  upsertUser,
  getUser,
  upsertInventoryItems,
  getInventory,
  getCachedPrice,
  upsertPriceCache,
  bulkUpsertSkinportPrices,
  getSkinportCachedPrice,
  isSkinportCacheFresh,
  recordPriceSnapshot,
  getPriceHistory,
  createAlert,
  getAlerts,
  getEnabledAlerts,
  markAlertTriggered,
  deleteAlert,
  toggleAlert,
  upsertTrackedProfile,
  getTrackedProfiles,
  getTrackedProfile,
  deleteTrackedProfile,
  touchProfileRefresh,
  getProfileStats,
  savePortfolioSnapshot,
  getPortfolioHistory,
};
