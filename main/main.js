'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

const { initDatabase, closeDatabase } = require('./db/database');
const { registerHandlers, cleanup } = require('./ipc/handlers');

const isDev = process.env.NODE_ENV === 'development';

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://*.steamstatic.com https://*.akamaihd.net",
  "connect-src 'self' https://api.steampowered.com https://steamcommunity.com",
  "font-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0f',
    title: 'CaseBase — CS2 Inventory Tracker',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    },
  });

  // CSP applies only to file:// (our app content).
  // The Steam auth window loads steamcommunity.com in its own BrowserWindow
  // and shares the default session — scoping by URL keeps Steam's pages intact.
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    if (details.url.startsWith('file://')) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [CSP],
          'X-Content-Type-Options': ['nosniff'],
          'X-Frame-Options': ['DENY'],
          'Referrer-Policy': ['no-referrer'],
        },
      });
    } else {
      callback({ responseHeaders: details.responseHeaders });
    }
  });

  // Lock down navigation on the MAIN window only — it should only ever load
  // file:// URLs. The Steam auth window is a separate BrowserWindow that
  // legitimately navigates between steamcommunity.com pages, so it must NOT
  // have this restriction applied.
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!navigationUrl.startsWith('file://')) {
      event.preventDefault();
    }
  });

  // Prevent the renderer from opening new windows (e.g. via <a target="_blank">).
  // The Steam auth window is opened programmatically in auth.js, not via window.open().
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  registerHandlers(mainWindow);

  mainWindow.on('closed', () => cleanup());

  return mainWindow;
}

function setupAutoUpdater(mainWindow) {
  // We don't code-sign Windows builds, so skip the signature verification entirely.
  // _verifyUpdateCodeSignature is electron-updater's documented override point.
  // Returning null means "no error — proceed with install."
  if (process.platform === 'win32') {
    autoUpdater._verifyUpdateCodeSignature = () => Promise.resolve(null);
  }

  autoUpdater.on('checking-for-update', () => console.log('[updater] Checking for update…'));
  autoUpdater.on('update-available', (info) => {
    console.log('[updater] Update available:', info.version);
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Available',
      message: `CaseBase ${info.version} is available.`,
      detail: 'Downloading now in the background. You\'ll be prompted to restart when it\'s ready.',
      buttons: ['OK'],
    });
  });
  autoUpdater.on('update-not-available', () => console.log('[updater] Up to date.'));
  autoUpdater.on('error', (err) => {
    console.error('[updater] Error:', err);
    // Suppress "latest.yml not found" — this happens when a release is mid-upload.
    // All other errors are also silent; updates are non-critical background checks.
  });
  autoUpdater.on('download-progress', (p) =>
    console.log(`[updater] Download ${Math.round(p.percent)}% (${Math.round(p.bytesPerSecond / 1024)} KB/s)`),
  );
  autoUpdater.on('update-downloaded', async (info) => {
    console.log('[updater] Update downloaded:', info.version);
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: `CaseBase ${info.version} is ready to install.`,
      detail: 'Restart now to apply the update, or continue and install on next launch.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  autoUpdater.checkForUpdatesAndNotify();
}

app.whenReady().then(() => {
  initDatabase();
  const mainWindow = createWindow();

  if (app.isPackaged) setupAutoUpdater(mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  closeDatabase();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  cleanup();
  closeDatabase();
});
