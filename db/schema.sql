-- CaseBase SQLite Schema

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  steam_id TEXT NOT NULL UNIQUE,
  persona_name TEXT,
  avatar_url TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  last_login INTEGER
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  steam_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  market_hash_name TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT,
  rarity TEXT,
  rarity_color TEXT,
  wear TEXT,
  icon_url TEXT,
  tradable INTEGER NOT NULL DEFAULT 0,
  marketable INTEGER NOT NULL DEFAULT 0,
  last_updated INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE(steam_id, asset_id)
);

CREATE TABLE IF NOT EXISTS price_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_hash_name TEXT NOT NULL UNIQUE,
  lowest_price TEXT,
  median_price TEXT,
  volume TEXT,
  fetched_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_hash_name TEXT NOT NULL,
  price_usd REAL,
  volume TEXT,
  recorded_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS price_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  steam_id TEXT NOT NULL,
  market_hash_name TEXT NOT NULL,
  target_price REAL NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('above','below')),
  enabled INTEGER NOT NULL DEFAULT 1,
  triggered INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  triggered_at INTEGER
);

CREATE TABLE IF NOT EXISTS tracked_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  steam_id TEXT NOT NULL UNIQUE,
  persona_name TEXT,
  avatar_url TEXT,
  profile_url TEXT,
  added_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  last_refreshed INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tracked_profiles_steam_id ON tracked_profiles(steam_id);
CREATE INDEX IF NOT EXISTS idx_inventory_steam_id ON inventory_items(steam_id);
CREATE INDEX IF NOT EXISTS idx_inventory_market_hash ON inventory_items(market_hash_name);
CREATE INDEX IF NOT EXISTS idx_price_history_hash ON price_history(market_hash_name);
CREATE INDEX IF NOT EXISTS idx_price_history_recorded ON price_history(recorded_at);
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  steam_id TEXT NOT NULL,
  total_value REAL NOT NULL,
  item_count INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_alerts_steam_id ON price_alerts(steam_id);
CREATE INDEX IF NOT EXISTS idx_cache_fetched ON price_cache(fetched_at);
CREATE INDEX IF NOT EXISTS idx_portfolio_steam_recorded ON portfolio_snapshots(steam_id, recorded_at);
