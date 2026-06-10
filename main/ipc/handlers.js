'use strict';

const { ipcMain, Notification, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const { steamLogin } = require('../steam/auth');
const { getPlayerSummary, getInventory, resolveProfileUrl } = require('../steam/api');
const { fetchSkinportItems } = require('../steam/skinport');
const {
  upsertUser, getUser,
  upsertInventoryItems, getInventory: dbGetInventory,
  getPriceHistory,
  bulkUpsertSkinportPrices, getSkinportCachedPrice, isSkinportCacheFresh,
  recordPriceSnapshot,
  createAlert, getAlerts, getEnabledAlerts, markAlertTriggered, deleteAlert, toggleAlert,
  upsertTrackedProfile, getTrackedProfiles, getTrackedProfile, deleteTrackedProfile, touchProfileRefresh,
  getProfileStats,
  savePortfolioSnapshot, getPortfolioHistory,
} = require('../db/queries');

// Alert notification copy — edit here to change wording
const ALERT_COPY = {
  above: (name, price) => `${name} is now $${price.toFixed(2)} on Skinport — time to cash out`,
  below: (name, price) => `${name} dropped to $${price.toFixed(2)} on Skinport`,
};
const { storeApiKey, hasApiKey, clearApiKey, getPreference, setPreference } = require('../storage');
const {
  validateSteamId,
  validateMarketHashName,
  validateApiKey,
  validateTargetPrice,
  validateDirection,
  validateAlertId,
  validatePreferenceKey,
  validatePreferenceValue,
  validateExportFormat,
  validateProfileInput,
} = require('./validators');

// Safe IPC reply wrapper — catches throws and serializes errors
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      console.error(`[IPC:${channel}]`, err.message);
      return { ok: false, error: err.message };
    }
  });
}

let alertCheckInterval = null;

function registerHandlers(mainWindow) {
  // ─── Auth ────────────────────────────────────────────────────────────────

  handle('steam:login', async () => {
    const { steamId } = await steamLogin();
    const summary = await getPlayerSummary(steamId);
    upsertUser({
      steamId,
      personaName: summary.personaName,
      avatarUrl: summary.avatarUrl,
    });
    setPreference('currentSteamId', steamId);
    // Return the DB row so the renderer always receives snake_case fields
    // (same shape as auth:get-current-user on subsequent launches)
    return getUser(steamId);
  });

  handle('steam:logout', async () => {
    setPreference('currentSteamId', null);
    return true;
  });

  handle('auth:get-current-user', async () => {
    const steamId = getPreference('currentSteamId');
    if (!steamId) return null;
    return getUser(steamId);
  });

  // ─── API Key ─────────────────────────────────────────────────────────────

  handle('apikey:save', async (rawKey) => {
    const key = validateApiKey(rawKey);
    storeApiKey(key);
    return true;
  });

  handle('apikey:has', async () => hasApiKey());

  handle('apikey:clear', async () => {
    clearApiKey();
    return true;
  });

  // ─── Inventory ────────────────────────────────────────────────────────────

  handle('inventory:refresh', async (rawSteamId) => {
    const steamId = validateSteamId(rawSteamId);
    const items = await getInventory(steamId);
    upsertInventoryItems(steamId, items);
    return dbGetInventory(steamId);
  });

  handle('inventory:get', async (rawSteamId) => {
    const steamId = validateSteamId(rawSteamId);
    return dbGetInventory(steamId);
  });

  // ─── Prices ───────────────────────────────────────────────────────────────

  handle('prices:fetch-batch', async (rawNames) => {
    if (!Array.isArray(rawNames)) throw new Error('Expected array of market hash names');
    if (rawNames.length > 500) throw new Error('Too many items requested at once');
    const names = rawNames.map(validateMarketHashName);

    // Refresh Skinport bulk cache if stale (fetchSkinportItems returns null when still fresh)
    if (!isSkinportCacheFresh()) {
      try {
        const freshItems = await fetchSkinportItems();
        if (freshItems && Array.isArray(freshItems)) {
          bulkUpsertSkinportPrices(freshItems);
          for (const item of freshItems) {
            if (item.min_price != null) {
              recordPriceSnapshot({
                marketHashName: item.market_hash_name,
                priceUsd: item.min_price,
                volume: item.quantity ?? 0,
                source: 'skinport',
              });
            }
          }
        }
      } catch (err) {
        console.error('[prices:fetch-batch] Skinport fetch failed, using cached data:', err.message);
      }
    }

    // Look up each requested item from local Skinport cache
    const total = names.length;
    const results = {};
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const row = getSkinportCachedPrice(name);
      results[name] = {
        lowestPrice: row?.min_price ?? null,
        suggestedPrice: row?.suggested_price ?? null,
        medianPrice: row?.median_price ?? null,
        volume: row?.quantity ?? null,
        fromSkinport: true,
      };
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('prices:progress', { done: i + 1, total });
      }
    }
    return results;
  });

  handle('prices:history', async (rawName) => {
    const name = validateMarketHashName(rawName);
    return getPriceHistory(name);
  });

  // ─── Alerts ───────────────────────────────────────────────────────────────

  handle('alerts:create', async ({ steamId: rawId, marketHashName: rawName, targetPrice: rawPrice, direction: rawDir }) => {
    const steamId = validateSteamId(rawId);
    const marketHashName = validateMarketHashName(rawName);
    const targetPrice = validateTargetPrice(rawPrice);
    const direction = validateDirection(rawDir);
    return createAlert({ steamId, marketHashName, targetPrice, direction });
  });

  handle('alerts:list', async (rawSteamId) => {
    const steamId = validateSteamId(rawSteamId);
    return getAlerts(steamId);
  });

  handle('alerts:delete', async (rawId) => {
    const id = validateAlertId(rawId);
    return deleteAlert(id);
  });

  handle('alerts:toggle', async ({ id: rawId, enabled }) => {
    const id = validateAlertId(rawId);
    if (typeof enabled !== 'boolean') throw new Error('enabled must be boolean');
    return toggleAlert(id, enabled);
  });

  // ─── Tracked Profiles (Friends) ───────────────────────────────────────────

  handle('profiles:add', async (rawInput) => {
    const input = validateProfileInput(rawInput);
    const steamId = await resolveProfileUrl(input);
    const summary = await getPlayerSummary(steamId);
    upsertTrackedProfile({
      steamId,
      personaName: summary.personaName,
      avatarUrl: summary.avatarUrl,
      profileUrl: summary.profileUrl,
    });
    return getTrackedProfile(steamId);
  });

  handle('profiles:list', async () => getTrackedProfiles());

  handle('profiles:remove', async (rawSteamId) => {
    const steamId = validateSteamId(rawSteamId);
    deleteTrackedProfile(steamId);
    return true;
  });

  handle('profiles:refresh-inventory', async (rawSteamId) => {
    const steamId = validateSteamId(rawSteamId);
    const items = await getInventory(steamId);
    upsertInventoryItems(steamId, items);
    touchProfileRefresh(steamId);
    return dbGetInventory(steamId);
  });

  handle('profiles:get-inventory', async (rawSteamId) => {
    const steamId = validateSteamId(rawSteamId);
    return dbGetInventory(steamId);
  });

  // ─── Portfolio ───────────────────────────────────────────────────────────

  handle('portfolio:snapshot', async (rawSteamId) => {
    const steamId = validateSteamId(rawSteamId);
    const items = dbGetInventory(steamId);
    const marketable = items.filter(i => i.marketable);
    let total = 0;
    for (const item of marketable) {
      const cached = getSkinportCachedPrice(item.market_hash_name);
      if (cached?.min_price != null) total += cached.min_price;
    }
    savePortfolioSnapshot({ steamId, totalValue: total, itemCount: marketable.length });
    return { totalValue: total, itemCount: marketable.length };
  });

  handle('portfolio:history', async (rawSteamId) => {
    const steamId = validateSteamId(rawSteamId);
    return getPortfolioHistory(steamId);
  });

  // ─── Preferences ─────────────────────────────────────────────────────────

  handle('prefs:get', async (key) => {
    const validKey = validatePreferenceKey(key);
    return getPreference(validKey);
  });

  handle('prefs:set', async ({ key, value }) => {
    const validKey = validatePreferenceKey(key);
    const validValue = validatePreferenceValue(validKey, value);
    setPreference(validKey, validValue);
    return true;
  });

  // ─── Export ───────────────────────────────────────────────────────────────

  handle('export:inventory', async ({ steamId: rawId, format: rawFormat }) => {
    const steamId = validateSteamId(rawId);
    const format = validateExportFormat(rawFormat);
    const items = dbGetInventory(steamId);

    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Export Inventory',
      defaultPath: `cs2-inventory.${format}`,
      filters: format === 'csv'
        ? [{ name: 'CSV', extensions: ['csv'] }]
        : [{ name: 'JSON', extensions: ['json'] }],
    });

    if (canceled || !filePath) return { canceled: true };

    if (format === 'csv') {
      const header = 'Name,MarketHashName,Wear,Type,Rarity,Tradable,Marketable,AssetID\n';
      const rows = items.map(i =>
        [i.name, i.market_hash_name, i.wear, i.type, i.rarity, i.tradable, i.marketable, i.asset_id]
          .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`)
          .join(',')
      ).join('\n');
      fs.writeFileSync(filePath, header + rows, 'utf8');
    } else {
      fs.writeFileSync(filePath, JSON.stringify(items, null, 2), 'utf8');
    }

    return { canceled: false, filePath };
  });

  // ─── External Links ──────────────────────────────────────────────────────

  handle('shell:open-external', async (rawUrl) => {
    if (typeof rawUrl !== 'string') throw new Error('Invalid URL');
    let parsed;
    try { parsed = new URL(rawUrl); } catch { throw new Error('Invalid URL format'); }
    if (parsed.hostname !== 'skinport.com') throw new Error('URL not allowed');
    await shell.openExternal(rawUrl);
    return true;
  });

  // ─── Profile Stats ────────────────────────────────────────────────────────

  handle('profiles:stats', async (rawSteamId) => {
    const steamId = validateSteamId(rawSteamId);
    return getProfileStats(steamId);
  });

  // ─── Alert Checker ───────────────────────────────────────────────────────

  function startAlertChecker() {
    if (alertCheckInterval) clearInterval(alertCheckInterval);

    alertCheckInterval = setInterval(async () => {
      const steamId = getPreference('currentSteamId');
      if (!steamId) return;

      const alerts = getEnabledAlerts(steamId);
      if (alerts.length === 0) return;

      for (const alert of alerts) {
        const cached = getSkinportCachedPrice(alert.market_hash_name);
        if (!cached || cached.min_price == null) continue;

        const price = cached.min_price;

        const triggered =
          (alert.direction === 'above' && price >= alert.target_price) ||
          (alert.direction === 'below' && price <= alert.target_price);

        if (triggered) {
          markAlertTriggered(alert.id);
          new Notification({
            title: 'CaseBase Price Alert',
            body: ALERT_COPY[alert.direction](alert.market_hash_name, price),
          }).show();

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('alerts:triggered', {
              alertId: alert.id,
              marketHashName: alert.market_hash_name,
              price,
              targetPrice: alert.target_price,
              direction: alert.direction,
            });
          }
        }
      }
    }, 60000); // Check every minute
  }

  startAlertChecker();
}

function cleanup() {
  if (alertCheckInterval) {
    clearInterval(alertCheckInterval);
    alertCheckInterval = null;
  }
}

module.exports = { registerHandlers, cleanup };
