# CaseBase — CS2 Skin Inventory Tracker

A secure Electron desktop app for tracking your CS2 skin inventory with real-time market prices, price history charts, and desktop price alerts.

---

## Features

- **Steam OpenID login** — no password stored; uses Steam's official OpenID 2.0 flow
- **Auto-import inventory** — pulls all CS2 items from your Steam inventory via the Steam Web API
- **Live market prices** — fetches lowest/median prices from the Steam Market, rate-limited to ≤1 req/sec with a 60-minute local cache
- **Price history charts** — Chart.js line graphs built from local SQLite snapshots taken on every refresh
- **Price alerts** — set a target price per skin; get a native OS desktop notification when the threshold is crossed
- **Export** — save your inventory to CSV or JSON
- **Dark cyberpunk UI** — neon green/orange accents on a dark background

---

## Security Architecture

| Concern | Implementation |
|---|---|
| No raw Node in renderer | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` |
| IPC allowlist | `preload.js` uses `contextBridge` with an explicit channel allowlist; all others are blocked |
| Input validation | Every IPC payload is validated in the main process before acting (`ipc/validators.js`) |
| API key storage | Encrypted via `safeStorage.encryptString` → stored as base64 in `electron-store`; never written in plain text |
| SQL injection | All queries use `better-sqlite3` parameterized prepared statements — zero string concatenation in SQL |
| CSP | `Content-Security-Policy` header set in `webRequest.onHeadersReceived` and via `<meta>` tag; blocks `unsafe-inline`, `unsafe-eval`, external non-Steam resources |
| Navigation lock | `will-navigate` event handler blocks all navigation away from `file://` |
| New window block | `setWindowOpenHandler` returns `deny` for all renderer-initiated windows |
| Steam API calls | Main process only — renderer never touches the network |
| Chart.js | Bundled locally (`renderer/chart.min.js`) — no CDN in production; satisfies `script-src 'self'` CSP |

---

## Prerequisites

- Node.js 18+ and npm
- A **Steam Web API key** — get yours at [https://steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey)
  - Domain name field: `localhost` (it's only used locally)

---

## Setup

```bash
# 1. Clone / extract the project
cd CaseBase

# 2. Install dependencies
npm install

# 3. Download Chart.js locally (required for price charts)
node scripts/download-chartjs.js

# 4. Launch in development mode
npm run dev
```

### First Launch — Enter Your API Key

On first launch you will see an **API Key** screen before the Steam login button appears.

1. Go to [https://steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey) and generate a key (domain: `localhost`)
2. Paste the key into the field and click **Save & Continue**
3. The key is immediately encrypted via your OS keychain (`safeStorage`) and the plain text is discarded

> The key is **never** written to disk in plain text. It lives only in memory during API calls.

### Steam Login

Click **Sign in via Steam**. A Steam login window opens in a separate `BrowserWindow`. After you authenticate, Steam redirects to a local callback server (`localhost:19583`) which completes the OpenID verification. The window closes automatically.

---

## Building for Distribution

```bash
# All platforms (from CI)
npm run build

# Linux (AppImage + deb)
npm run build:linux

# Windows (NSIS installer)
npm run build:win

# macOS (DMG)
npm run build:mac
```

Distributables are written to `dist/`.

---

## Project Structure

```
CaseBase/
├── main/
│   ├── main.js            Electron main process — window creation, CSP, app lifecycle
│   ├── preload.js         contextBridge — exposes only allowed IPC channels to renderer
│   ├── storage.js         safeStorage API key encryption + electron-store preferences
│   ├── ipc/
│   │   ├── handlers.js    All ipcMain.handle registrations + alert checker
│   │   └── validators.js  Input validation for every IPC channel
│   ├── steam/
│   │   ├── auth.js        Steam OpenID 2.0 login flow
│   │   ├── api.js         Steam Web API + Market price fetching
│   │   └── ratelimit.js   Token-bucket rate limiter (1 req/sec market, 60/min API)
│   └── db/
│       ├── database.js    SQLite init via better-sqlite3
│       ├── queries.js     All prepared statement queries
│       └── init.js        Standalone DB init script for development
├── renderer/
│   ├── index.html         App shell + CSP meta tag
│   ├── app.js             Vanilla JS UI logic
│   ├── charts.js          Chart.js wrapper for price history
│   ├── styles.css         Dark cyberpunk theme
│   └── chart.min.js       Chart.js bundle (downloaded by setup script — not in git)
├── db/
│   └── schema.sql         SQLite schema (users, inventory, price_cache, price_history, alerts)
├── scripts/
│   └── download-chartjs.js  Downloads Chart.js to renderer/ locally
├── .env.example           STEAM_API_KEY placeholder
├── .gitignore
└── package.json
```

---

## Rate Limits

| Endpoint | Limit applied |
|---|---|
| Steam Market `/priceoverview/` | 1 request/second (token bucket), 60-minute cache |
| Steam Web API (inventory, player summary) | 60 requests/minute (token bucket) |

Inventory pages are fetched sequentially (Steam returns up to 5000 items per page).

---

## Price History

Price snapshots are recorded in the `price_history` SQLite table each time a live price is fetched (cache misses only). The chart in the skin detail modal shows all stored snapshots for that item. The longer you run the app, the more data your charts will have.

---

## Troubleshooting

**"OS keychain encryption is not available"** — On Linux, ensure `libsecret` is installed (`apt install libsecret-1-dev` or equivalent). Electron `safeStorage` requires a D-Bus secret service (GNOME Keyring or KWallet).

**Blank inventory after refresh** — Make sure your Steam inventory is set to **Public** in your Steam privacy settings. The Steam inventory API returns an error for private profiles.

**Price fetch stuck** — Steam's market API has unofficial rate limits. The app enforces 1 req/sec, but Steam may still throttle. Prices will retry on the next refresh.

**Login window doesn't close** — If you close the Steam login window manually before completing auth, click the login button again.
