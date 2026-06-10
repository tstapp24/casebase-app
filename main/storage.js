 'use strict';

const { safeStorage } = require('electron');
const Store = require('electron-store');

// Preferences store (non-sensitive)
const store = new Store({
  name: 'preferences',
  defaults: {
    hasEncryptedApiKey: false,
    currentSteamId: null,
    alertsEnabled: true,
    refreshIntervalMinutes: 30,
    currency: 'USD',
    theme: 'dark',
  },
});

const API_KEY_FILE_KEY = 'encryptedApiKey';

let decryptedApiKeyCache = null;

function storeApiKey(plainKey) {
  if (!plainKey || typeof plainKey !== 'string') {
    throw new Error('Invalid API key');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS keychain encryption is not available on this system');
  }

  const encrypted = safeStorage.encryptString(plainKey);
  store.set(API_KEY_FILE_KEY, encrypted.toString('base64'));
  store.set('hasEncryptedApiKey', true);
  decryptedApiKeyCache = plainKey;
}

function getApiKey() {
  if (decryptedApiKeyCache) return decryptedApiKeyCache;

  const b64 = store.get(API_KEY_FILE_KEY);
  if (!b64) return null;

  if (!safeStorage.isEncryptionAvailable()) return null;

  try {
    const encrypted = Buffer.from(b64, 'base64');
    decryptedApiKeyCache = safeStorage.decryptString(encrypted);
    return decryptedApiKeyCache;
  } catch {
    return null;
  }
}

function clearApiKey() {
  store.delete(API_KEY_FILE_KEY);
  store.set('hasEncryptedApiKey', false);
  decryptedApiKeyCache = null;
}

function hasApiKey() {
  return store.get('hasEncryptedApiKey') === true;
}

function getPreference(key) {
  return store.get(key);
}

function setPreference(key, value) {
  const ALLOWED_KEYS = [
    'currentSteamId',
    'alertsEnabled',
    'refreshIntervalMinutes',
    'currency',
    'theme',
  ];
  if (!ALLOWED_KEYS.includes(key)) throw new Error(`Unknown preference key: ${key}`);
  store.set(key, value);
}

module.exports = { storeApiKey, getApiKey, clearApiKey, hasApiKey, getPreference, setPreference };
