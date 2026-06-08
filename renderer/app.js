'use strict';

// ── Helpers ──────────────────────────────────────────────────────────────────

function $(id) { return document.getElementById(id); }

function toast(msg, type = 'info', duration = 3500) {
  const container = $('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

async function ipc(channel, ...args) {
  const res = await window.api.invoke(channel, ...args);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

function parsePrice(str) {
  if (!str) return null;
  const n = parseFloat(str.replace(/[^0-9.]/g, ''));
  return isNaN(n) ? null : n;
}

function formatUSD(n) {
  if (n == null) return '—';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  currentUser: null,
  // viewingSteamId: null = own account, otherwise a friend's SteamID
  viewingSteamId: null,
  inventory: [],
  prices: {},
  pricesLoading: new Set(),
  activePanel: 'inventory',
  modalItem: null,
  refreshTimer: null,
};

// ── Panels ───────────────────────────────────────────────────────────────────

function showPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const panel = $(`panel-${name}`);
  if (panel) panel.classList.add('active');

  const navItem = document.querySelector(`.nav-item[data-panel="${name}"]`);
  if (navItem) navItem.classList.add('active');

  const titles = { inventory: 'Inventory', portfolio: 'Portfolio', friends: 'Friends', alerts: 'Price Alerts', settings: 'Settings' };
  $('panel-title').textContent = titles[name] || name;

  const inventoryActions = ['refresh-btn', 'export-csv-btn', 'export-json-btn', 'refresh-progress'];
  inventoryActions.forEach(id => {
    const el = $(id);
    if (el) el.style.display = name === 'inventory' ? '' : 'none';
  });

  state.activePanel = name;

  if (name === 'alerts') loadAlerts();
  if (name === 'settings') loadSettings();
  if (name === 'friends') loadFriends();
  if (name === 'portfolio') loadPortfolio();
}

// ── Auth / Login ─────────────────────────────────────────────────────────────

async function checkInitialState() {
  let hasKey = false;
  try { hasKey = await ipc('apikey:has'); } catch {}

  if (!hasKey) {
    $('api-key-card').style.display = 'flex';
    $('login-card').style.display = 'none';
  } else {
    $('api-key-card').style.display = 'none';
    $('login-card').style.display = 'flex';
  }

  let user = null;
  try { user = await ipc('auth:get-current-user'); } catch {}

  if (user) {
    await enterApp(user);
  }
}

async function enterApp(user) {
  state.currentUser = user;
  $('login-screen').style.display = 'none';
  $('app').style.display = 'flex';
  renderSidebarUser(user);
  await loadInventory();
  startAutoRefresh();
}

function renderSidebarUser(user) {
  const el = $('sidebar-user');
  if (!user) {
    el.innerHTML = '<div style="color:var(--text-muted); font-size:12px;">Not signed in</div>';
    return;
  }
  el.innerHTML = `
    <img class="user-avatar" src="${sanitizeUrl(user.avatar_url)}" alt="${escapeHtml(user.persona_name)}" onerror="this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'36\\' height=\\'36\\'><rect width=\\'36\\' height=\\'36\\' fill=\\'%231e1e38\\'/></svg>'">
    <div class="user-info">
      <div class="user-name">${escapeHtml(user.persona_name || 'Unknown')}</div>
      <div class="user-steam-id">${escapeHtml(user.steam_id)}</div>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.protocol === 'data:') return url;
    if (u.protocol === 'https:' &&
        (u.hostname.endsWith('.steamstatic.com') || u.hostname.endsWith('.akamaihd.net'))) {
      return url;
    }
  } catch { /* invalid URL */ }
  return '';
}

// ── Inventory ────────────────────────────────────────────────────────────────

function activeSteamId() {
  return state.viewingSteamId || state.currentUser?.steam_id;
}

function updateViewingBanner(profile) {
  const banner = $('viewing-profile-banner');
  if (!profile) {
    banner.style.display = 'none';
    return;
  }
  banner.style.display = 'flex';
  $('viewing-avatar').src = sanitizeUrl(profile.avatar_url) || '';
  $('viewing-name').textContent = profile.persona_name || profile.steam_id;
}

async function viewFriendInventory(profile) {
  state.viewingSteamId = profile.steam_id;
  state.inventory = [];
  state.prices = {};
  updateViewingBanner(profile);
  showPanel('inventory');
  await loadInventory(false);
}

async function loadInventory(forceRefresh = false) {
  const steamId = activeSteamId();
  if (!steamId) return;

  const isFriend = !!state.viewingSteamId;
  const refreshChannel = isFriend ? 'profiles:refresh-inventory' : 'inventory:refresh';
  const getChannel    = isFriend ? 'profiles:get-inventory'     : 'inventory:get';

  if (forceRefresh) {
    try {
      toast('Refreshing inventory from Steam…', 'info');
      state.inventory = await ipc(refreshChannel, steamId);
    } catch (err) {
      toast(`Refresh failed: ${err.message}`, 'error');
    }
  }

  if (state.inventory.length === 0) {
    try {
      state.inventory = await ipc(getChannel, steamId);
    } catch (err) {
      toast(`Could not load inventory: ${err.message}`, 'error');
      return;
    }
  }

  renderInventory();
  await fetchAllPrices();
}

function getFilteredInventory() {
  const search = $('search-input').value.toLowerCase().trim();
  const wear = $('wear-filter').value;
  const sort = $('sort-select').value;

  let items = state.inventory.filter(item => {
    if (search && !item.name.toLowerCase().includes(search) && !item.market_hash_name.toLowerCase().includes(search)) return false;
    if (wear && item.wear !== wear) return false;
    return true;
  });

  items.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'price-desc' || sort === 'price-asc') {
      const pa = parsePrice(state.prices[a.market_hash_name]?.lowestPrice) ?? -1;
      const pb = parsePrice(state.prices[b.market_hash_name]?.lowestPrice) ?? -1;
      return sort === 'price-desc' ? pb - pa : pa - pb;
    }
    return 0;
  });

  return items;
}

function renderInventory() {
  const grid = $('inventory-grid');
  const items = getFilteredInventory();
  const marketable = state.inventory.filter(i => i.marketable).length;

  $('stat-count').textContent = state.inventory.length;
  $('stat-marketable').textContent = marketable;

  // Compute total value
  let total = 0;
  let counted = 0;
  for (const item of state.inventory) {
    const p = parsePrice(state.prices[item.market_hash_name]?.lowestPrice);
    if (p !== null) { total += p; counted++; }
  }
  $('stat-value').textContent = counted > 0 ? formatUSD(total) : '—';

  if (items.length === 0) {
    grid.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🎒</div>
      <h3>${state.inventory.length === 0 ? 'No inventory loaded' : 'No items match your filter'}</h3>
      <p>${state.inventory.length === 0 ? 'Click Refresh to import your CS2 inventory from Steam.' : 'Try adjusting your search or filters.'}</p>
    </div>`;
    return;
  }

  grid.innerHTML = items.map(item => skinCardHTML(item)).join('');

  // Attach click listeners
  grid.querySelectorAll('.skin-card').forEach(card => {
    card.addEventListener('click', () => {
      const assetId = card.dataset.assetId;
      const item = state.inventory.find(i => i.asset_id === assetId);
      if (item) openModal(item);
    });
  });
}

function skinCardHTML(item) {
  const price = state.prices[item.market_hash_name];
  let priceHtml;
  if (state.pricesLoading.has(item.market_hash_name)) {
    priceHtml = `<div class="skin-price loading">Fetching…</div>`;
  } else if (!price) {
    priceHtml = item.marketable
      ? `<div class="skin-price loading">—</div>`
      : `<div class="skin-price error">Not marketable</div>`;
  } else if (price.error) {
    priceHtml = `<div class="skin-price error">Price unavailable</div>`;
  } else {
    priceHtml = `<div class="skin-price">${escapeHtml(price.lowestPrice || '—')}</div>`;
  }

  const imgSrc = sanitizeUrl(item.icon_url) || '';
  const rarityColor = item.rarity_color || '#4a4a6a';

  return `
    <div class="skin-card" data-asset-id="${escapeHtml(item.asset_id)}">
      ${!item.marketable ? '<div class="not-marketable-badge">Not Tradable</div>' : ''}
      <img class="skin-card-img" src="${escapeHtml(imgSrc)}" alt="${escapeHtml(item.name)}" loading="lazy"
        onerror="this.style.opacity='0.2'">
      <div class="skin-card-body">
        <div class="skin-rarity-bar" style="background:${escapeHtml(rarityColor)};"></div>
        <div class="skin-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
        <div class="skin-wear">${escapeHtml(item.wear || '—')}</div>
        ${priceHtml}
      </div>
    </div>
  `;
}

// ── Price Fetching ────────────────────────────────────────────────────────────

async function fetchAllPrices() {
  if (!state.inventory.length) return;

  const marketable = state.inventory.filter(i => i.marketable);
  if (marketable.length === 0) return;

  const names = [...new Set(marketable.map(i => i.market_hash_name))];

  names.forEach(n => state.pricesLoading.add(n));
  renderInventory();

  $('refresh-progress').style.display = 'flex';
  $('progress-bar').style.width = '0%';

  // Listen for progress updates
  const cleanup = window.api.on('prices:progress', ({ done, total }) => {
    const pct = Math.round((done / total) * 100);
    $('progress-bar').style.width = `${pct}%`;
    $('progress-text').textContent = `Fetching prices… ${done}/${total}`;
  });

  try {
    const results = await ipc('prices:fetch-batch', names);
    Object.assign(state.prices, results);
    names.forEach(n => state.pricesLoading.delete(n));
    // Save a portfolio snapshot after every successful price fetch (own account only)
    const snapId = state.viewingSteamId ? null : state.currentUser?.steam_id;
    if (snapId) ipc('portfolio:snapshot', snapId).catch(() => {});
  } catch (err) {
    toast(`Price fetch error: ${err.message}`, 'error');
    names.forEach(n => state.pricesLoading.delete(n));
  } finally {
    cleanup();
    $('refresh-progress').style.display = 'none';
    renderInventory();
  }
}

// ── Alerts ────────────────────────────────────────────────────────────────────

async function loadAlerts() {
  if (!state.currentUser) return;
  try {
    const alerts = await ipc('alerts:list', state.currentUser.steam_id);
    $('stat-alerts').textContent = alerts.filter(a => a.enabled && !a.triggered).length;
    renderAlerts(alerts);
  } catch (err) {
    toast(`Could not load alerts: ${err.message}`, 'error');
  }
}

function renderAlerts(alerts) {
  const list = $('alerts-list');
  if (alerts.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🔔</div>
      <h3>No alerts set</h3>
      <p>Add a price alert above to get OS notifications when a skin crosses your target price.</p>
    </div>`;
    return;
  }

  list.innerHTML = alerts.map(a => {
    const status = a.triggered ? 'triggered' : a.enabled ? 'active' : 'disabled';
    const statusLabel = a.triggered ? 'Triggered' : a.enabled ? 'Active' : 'Disabled';
    return `
      <div class="alert-card" data-alert-id="${a.id}">
        <div class="alert-info">
          <div class="alert-name" title="${escapeHtml(a.market_hash_name)}">${escapeHtml(a.market_hash_name)}</div>
          <div class="alert-meta">
            Notify when price ${escapeHtml(a.direction)} ${formatUSD(a.target_price)}
          </div>
        </div>
        <div class="alert-status ${status}">${statusLabel}</div>
        <div class="alert-actions">
          ${!a.triggered ? `<button class="btn btn-secondary btn-sm toggle-alert-btn" data-id="${a.id}" data-enabled="${a.enabled}">${a.enabled ? 'Disable' : 'Enable'}</button>` : ''}
          <button class="btn btn-danger btn-sm delete-alert-btn" data-id="${a.id}">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.delete-alert-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.id, 10);
      try {
        await ipc('alerts:delete', id);
        toast('Alert deleted', 'success');
        loadAlerts();
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  list.querySelectorAll('.toggle-alert-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.id, 10);
      const enabled = btn.dataset.enabled === 'true';
      try {
        await ipc('alerts:toggle', { id, enabled: !enabled });
        loadAlerts();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function openModal(item) {
  state.modalItem = item;
  const price = state.prices[item.market_hash_name];

  $('modal-img').src = sanitizeUrl(item.icon_url) || '';
  $('modal-img').alt = item.name;
  $('modal-name').textContent = item.name;
  $('modal-wear').textContent = item.wear || '—';

  if (price && !price.error) {
    $('modal-price').textContent = price.lowestPrice || '—';
    $('modal-volume').textContent = price.volume ? `${price.volume} sold` : '';
  } else {
    $('modal-price').textContent = '—';
    $('modal-volume').textContent = '';
  }

  // Info table
  const rows = [
    ['Market Name', item.market_hash_name],
    ['Asset ID', item.asset_id],
    ['Type', item.type],
    ['Rarity', item.rarity],
    ['Wear', item.wear],
    ['Tradable', item.tradable ? 'Yes' : 'No'],
    ['Marketable', item.marketable ? 'Yes' : 'No'],
    ['Median Price', price?.medianPrice || '—'],
  ];

  $('modal-info-table').innerHTML = rows.map(([k, v]) => `
    <tr>
      <td style="padding:8px 0; color:var(--text-muted); width:40%; border-bottom:1px solid var(--border);">${escapeHtml(k)}</td>
      <td style="padding:8px 0; border-bottom:1px solid var(--border); font-family:var(--font-mono); font-size:12px;">${escapeHtml(String(v ?? '—'))}</td>
    </tr>
  `).join('');

  // Switch to chart tab
  switchModalTab('chart');

  $('skin-modal').classList.add('open');
  loadPriceChart(item.market_hash_name);
}

function closeModal() {
  $('skin-modal').classList.remove('open');
  if (window.destroyPriceChart) window.destroyPriceChart();
  state.modalItem = null;
}

function switchModalTab(tabName) {
  document.querySelectorAll('.modal-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  document.querySelectorAll('.modal-tab-panel').forEach(p => p.classList.toggle('active', p.id === `modal-tab-${tabName}`));
}

async function loadPriceChart(marketHashName) {
  try {
    const history = await ipc('prices:history', marketHashName);
    if (window.renderPriceChart) window.renderPriceChart('price-chart', history);
  } catch (err) {
    console.error('Chart load error:', err.message);
  }
}

// ── Friends ───────────────────────────────────────────────────────────────────

async function loadFriends() {
  let profiles = [];
  try { profiles = await ipc('profiles:list'); } catch (err) {
    toast(`Could not load profiles: ${err.message}`, 'error');
    return;
  }
  renderFriends(profiles);
}

function renderFriends(profiles) {
  const grid = $('friends-grid');
  if (!profiles.length) {
    grid.innerHTML = `<div class="empty-state">
      <div class="empty-icon">👥</div>
      <h3>No profiles tracked yet</h3>
      <p>Paste a Steam profile URL or SteamID64 above to start tracking a friend's inventory.</p>
    </div>`;
    return;
  }

  grid.innerHTML = profiles.map(p => {
    const avatarSrc = sanitizeUrl(p.avatar_url) || '';
    return `
      <div class="friend-card" data-steam-id="${escapeHtml(p.steam_id)}">
        <button class="friend-remove-btn" data-steam-id="${escapeHtml(p.steam_id)}" title="Remove">✕</button>
        <div class="friend-card-header">
          <img class="friend-avatar" src="${escapeHtml(avatarSrc)}" alt=""
            onerror="this.style.opacity='0.3'">
          <div class="friend-info">
            <div class="friend-name" title="${escapeHtml(p.persona_name || p.steam_id)}">${escapeHtml(p.persona_name || 'Unknown')}</div>
            <div class="friend-steamid">${escapeHtml(p.steam_id)}</div>
          </div>
        </div>
        <div class="friend-actions">
          <button class="btn btn-secondary btn-sm view-inventory-btn" data-steam-id="${escapeHtml(p.steam_id)}" style="flex:1;">
            🎒 View Inventory
          </button>
          <button class="btn btn-secondary btn-sm refresh-friend-btn" data-steam-id="${escapeHtml(p.steam_id)}" title="Refresh inventory">↻</button>
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('.view-inventory-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const profile = profiles.find(p => p.steam_id === btn.dataset.steamId);
      if (profile) viewFriendInventory(profile);
    });
  });

  grid.querySelectorAll('.refresh-friend-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '…';
      try {
        await ipc('profiles:refresh-inventory', btn.dataset.steamId);
        toast('Inventory refreshed', 'success');
      } catch (err) { toast(err.message, 'error'); }
      finally { btn.disabled = false; btn.textContent = '↻'; }
    });
  });

  grid.querySelectorAll('.friend-remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await ipc('profiles:remove', btn.dataset.steamId);
        // If we were viewing this profile, go back to own inventory
        if (state.viewingSteamId === btn.dataset.steamId) backToOwnInventory();
        loadFriends();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

function backToOwnInventory() {
  state.viewingSteamId = null;
  state.inventory = [];
  state.prices = {};
  updateViewingBanner(null);
  loadInventory(false);
}

// ── Portfolio ─────────────────────────────────────────────────────────────────

async function loadPortfolio() {
  if (!state.currentUser) return;
  const steamId = state.currentUser.steam_id;

  let history = [];
  try { history = await ipc('portfolio:history', steamId); } catch (e) { /* silent */ }

  await loadChartJs();

  const currentVal = history.length ? history[history.length - 1].total_value : 0;
  const firstVal = history.length ? history[0].total_value : 0;
  const diff = currentVal - firstVal;
  const pct = firstVal > 0 ? ((diff / firstVal) * 100) : 0;
  const sign = diff >= 0 ? '+' : '';
  const isUp = diff >= 0;

  $('port-current-value').textContent = history.length ? `$${currentVal.toFixed(2)}` : '—';
  $('port-change-abs').textContent = history.length ? `${sign}$${diff.toFixed(2)}` : '—';
  $('port-change-abs').className = `portfolio-stat-value ${history.length ? (isUp ? 'green' : 'red') : ''}`;
  $('port-change-pct').textContent = history.length ? `${sign}${pct.toFixed(2)}%` : '—';
  $('port-change-pct').className = `portfolio-stat-value ${history.length ? (isUp ? 'green' : 'red') : ''}`;
  $('port-item-count').textContent = history.length ? String(history[history.length - 1].item_count) : '—';

  if (window.renderPortfolioChart) {
    window.renderPortfolioChart('portfolio-chart', history);
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────

async function loadSettings() {
  const hasKey = await ipc('apikey:has').catch(() => false);
  $('api-key-status').textContent = hasKey ? 'Encrypted key stored in OS keychain ✓' : 'No API key configured';

  const alertsEnabled = await ipc('prefs:get', 'alertsEnabled').catch(() => true);
  $('pref-alerts-enabled').checked = alertsEnabled;

  const interval = await ipc('prefs:get', 'refreshIntervalMinutes').catch(() => 30);
  $('pref-refresh-interval').value = String(interval);
}

// ── Auto Refresh ──────────────────────────────────────────────────────────────

function startAutoRefresh() {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  ipc('prefs:get', 'refreshIntervalMinutes').then(mins => {
    if (!mins || mins === 0) return;
    state.refreshTimer = setInterval(() => {
      if (state.activePanel === 'inventory') fetchAllPrices();
    }, mins * 60 * 1000);
  }).catch(() => {});
}

// ── Event Wiring ──────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Load Chart.js dynamically from local bundle
  await loadChartJs();

  // Nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => showPanel(item.dataset.panel));
  });

  // API Key — show/hide toggle
  $('toggle-key-visibility').addEventListener('click', () => {
    const input = $('api-key-input');
    const btn = $('toggle-key-visibility');
    if (input.type === 'password') {
      input.type = 'text';
      btn.textContent = '🙈';
    } else {
      input.type = 'password';
      btn.textContent = '👁';
    }
  });

  // API Key save (first-run flow)
  $('save-api-key-btn').addEventListener('click', async () => {
    const key = $('api-key-input').value.trim();
    if (!key) return toast('Please enter your API key', 'error');
    try {
      await ipc('apikey:save', key);
      $('api-key-input').value = '';
      $('api-key-input').type = 'password';
      $('toggle-key-visibility').textContent = '👁';
      $('api-key-card').style.display = 'none';
      $('login-card').style.display = 'flex';
      toast('API key saved securely', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });

  // Steam login
  $('steam-login-btn').addEventListener('click', async () => {
    $('steam-login-btn').disabled = true;
    $('steam-login-btn').textContent = 'Opening Steam…';
    try {
      const user = await ipc('steam:login');
      await enterApp(user);
      toast(`Signed in as ${user.persona_name}`, 'success');
    } catch (err) {
      toast(err.message || 'Login failed', 'error');
      $('steam-login-btn').disabled = false;
      $('steam-login-btn').innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.029 4.524 4.524s-2.03 4.523-4.524 4.523h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.606 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.455 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.252 0-2.265-1.014-2.265-2.265z"/></svg> Sign in via Steam`;
    }
  });

  // Logout
  $('logout-btn').addEventListener('click', async () => {
    await ipc('steam:logout').catch(() => {});
    state.currentUser = null;
    state.viewingSteamId = null;
    state.inventory = [];
    state.prices = {};
    updateViewingBanner(null);
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    $('app').style.display = 'none';
    $('login-screen').style.display = 'flex';
    const hasKey = await ipc('apikey:has').catch(() => false);
    $('api-key-card').style.display = hasKey ? 'none' : 'flex';
    $('login-card').style.display = hasKey ? 'flex' : 'none';
  });

  // Refresh button
  $('refresh-btn').addEventListener('click', () => loadInventory(true));

  // Back to own inventory from friend view
  $('back-to-own-btn').addEventListener('click', backToOwnInventory);

  // Add friend
  $('add-friend-btn').addEventListener('click', async () => {
    const input = $('friend-url-input').value.trim();
    if (!input) return toast('Enter a Steam profile URL or SteamID64', 'error');
    const btn = $('add-friend-btn');
    const btnText = $('add-friend-btn-text');
    btn.disabled = true;
    btnText.textContent = 'Resolving…';
    try {
      const profile = await ipc('profiles:add', input);
      $('friend-url-input').value = '';
      toast(`Added ${profile.persona_name}`, 'success');
      loadFriends();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btnText.textContent = '+ Add Profile';
    }
  });

  // Export buttons
  $('export-csv-btn').addEventListener('click', () => exportInventory('csv'));
  $('export-json-btn').addEventListener('click', () => exportInventory('json'));
  $('settings-export-csv').addEventListener('click', () => exportInventory('csv'));
  $('settings-export-json').addEventListener('click', () => exportInventory('json'));

  // Search + filter
  $('search-input').addEventListener('input', renderInventory);
  $('wear-filter').addEventListener('change', renderInventory);
  $('sort-select').addEventListener('change', renderInventory);

  // Modal
  $('modal-close-btn').addEventListener('click', closeModal);
  $('skin-modal').addEventListener('click', (e) => { if (e.target === $('skin-modal')) closeModal(); });
  document.querySelectorAll('.modal-tab').forEach(tab => {
    tab.addEventListener('click', () => switchModalTab(tab.dataset.tab));
  });

  // Modal alert creation
  $('modal-create-alert-btn').addEventListener('click', async () => {
    if (!state.modalItem || !state.currentUser) return;
    const price = parseFloat($('modal-alert-price').value);
    const dir = $('modal-alert-dir').value;
    if (!price || price <= 0) return toast('Enter a valid target price', 'error');
    try {
      await ipc('alerts:create', {
        steamId: state.currentUser.steam_id,
        marketHashName: state.modalItem.market_hash_name,
        targetPrice: price,
        direction: dir,
      });
      toast('Alert created', 'success');
      $('modal-alert-price').value = '';
    } catch (err) { toast(err.message, 'error'); }
  });

  // Alerts panel — create form
  $('create-alert-btn').addEventListener('click', async () => {
    if (!state.currentUser) return;
    const name = $('alert-skin-input').value.trim();
    const price = parseFloat($('alert-price-input').value);
    const dir = $('alert-dir-select').value;
    if (!name) return toast('Enter a skin market name', 'error');
    if (!price || price <= 0) return toast('Enter a valid target price', 'error');
    try {
      await ipc('alerts:create', {
        steamId: state.currentUser.steam_id,
        marketHashName: name,
        targetPrice: price,
        direction: dir,
      });
      toast('Alert created', 'success');
      $('alert-skin-input').value = '';
      $('alert-price-input').value = '';
      loadAlerts();
    } catch (err) { toast(err.message, 'error'); }
  });

  // Settings — API key change
  $('change-api-key-btn').addEventListener('click', () => {
    const form = $('api-key-change-form');
    form.style.display = form.style.display === 'none' || !form.style.display ? 'block' : 'none';
  });

  $('settings-save-key-btn').addEventListener('click', async () => {
    const key = $('settings-api-key-input').value.trim();
    if (!key) return toast('Enter a new API key', 'error');
    try {
      await ipc('apikey:save', key);
      $('settings-api-key-input').value = '';
      $('api-key-change-form').style.display = 'none';
      toast('API key updated', 'success');
      loadSettings();
    } catch (err) { toast(err.message, 'error'); }
  });

  // Settings — preferences
  $('pref-alerts-enabled').addEventListener('change', async (e) => {
    await ipc('prefs:set', { key: 'alertsEnabled', value: e.target.checked }).catch(() => {});
  });

  $('pref-refresh-interval').addEventListener('change', async (e) => {
    const val = parseInt(e.target.value, 10);
    await ipc('prefs:set', { key: 'refreshIntervalMinutes', value: val }).catch(() => {});
    startAutoRefresh();
  });

  // Alert triggered events from main process
  window.api.on('alerts:triggered', ({ marketHashName, price, targetPrice, direction }) => {
    toast(`Alert: ${marketHashName} is ${formatUSD(price)} (target: ${direction} ${formatUSD(targetPrice)})`, 'info', 6000);
    if (state.activePanel === 'alerts') loadAlerts();
    // Update stat
    ipc('alerts:list', state.currentUser?.steam_id).then(alerts => {
      $('stat-alerts').textContent = alerts.filter(a => a.enabled && !a.triggered).length;
    }).catch(() => {});
  });

  // Init
  await checkInitialState();
});

async function exportInventory(format) {
  const steamId = activeSteamId();
  if (!steamId) return toast('Not signed in', 'error');
  try {
    const result = await ipc('export:inventory', { steamId, format });
    if (result && !result.canceled) toast(`Exported to ${result.filePath}`, 'success');
  } catch (err) { toast(err.message, 'error'); }
}

// ── Chart.js loader ───────────────────────────────────────────────────────────

function loadChartJs() {
  return new Promise((resolve, reject) => {
    if (window.Chart) { resolve(); return; }
    const script = document.createElement('script');
    script.src = 'chart.min.js';
    script.onload = () => {
      // Load our charts module too
      const chartsScript = document.createElement('script');
      chartsScript.src = 'charts.js';
      chartsScript.onload = resolve;
      chartsScript.onerror = reject;
      document.head.appendChild(chartsScript);
    };
    script.onerror = () => {
      console.warn('Chart.js not found — charts will be unavailable');
      resolve(); // non-fatal
    };
    document.head.appendChild(script);
  });
}
