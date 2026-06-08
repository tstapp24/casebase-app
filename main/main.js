'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');

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

app.whenReady().then(() => {
  initDatabase();
  createWindow();

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
