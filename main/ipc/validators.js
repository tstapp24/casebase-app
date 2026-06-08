'use strict';

// Validate all IPC inputs in the main process — treat renderer as untrusted.

function isString(v) { return typeof v === 'string'; }
function isNumber(v) { return typeof v === 'number' && isFinite(v); }
function isBoolean(v) { return typeof v === 'boolean'; }

function validateSteamId(steamId) {
  if (!isString(steamId)) throw new Error('steamId must be a string');
  if (!/^\d{17}$/.test(steamId)) throw new Error('Invalid SteamID64 format');
  return steamId;
}

function validateMarketHashName(name) {
  if (!isString(name)) throw new Error('marketHashName must be a string');
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 200) throw new Error('Invalid market hash name length');
  // Allow printable ASCII except control chars and null bytes
  if (/[\x00-\x1f\x7f]/.test(trimmed)) throw new Error('marketHashName contains invalid characters');
  return trimmed;
}

function validateApiKey(key) {
  if (!isString(key)) throw new Error('API key must be a string');
  const trimmed = key.trim();
  if (trimmed.length < 10 || trimmed.length > 64) throw new Error('API key has invalid length');
  if (!/^[A-Za-z0-9]+$/.test(trimmed)) throw new Error('API key contains invalid characters');
  return trimmed;
}

function validateTargetPrice(price) {
  const n = Number(price);
  if (!isFinite(n) || n <= 0 || n > 1000000) throw new Error('Target price must be a positive number ≤ 1,000,000');
  return n;
}

function validateDirection(dir) {
  if (dir !== 'above' && dir !== 'below') throw new Error('Direction must be "above" or "below"');
  return dir;
}

function validateAlertId(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new Error('Alert ID must be a positive integer');
  return n;
}

function validatePreferenceKey(key) {
  const ALLOWED = ['alertsEnabled', 'refreshIntervalMinutes', 'currency', 'theme'];
  if (!ALLOWED.includes(key)) throw new Error(`Unknown preference key: ${key}`);
  return key;
}

function validatePreferenceValue(key, value) {
  switch (key) {
    case 'alertsEnabled':
      if (!isBoolean(value)) throw new Error('alertsEnabled must be boolean');
      break;
    case 'refreshIntervalMinutes':
      if (!isNumber(value) || value < 5 || value > 1440) throw new Error('refreshIntervalMinutes must be 5–1440');
      break;
    case 'currency':
      if (!['USD', 'EUR', 'GBP'].includes(value)) throw new Error('Invalid currency');
      break;
    case 'theme':
      if (!['dark', 'light'].includes(value)) throw new Error('Invalid theme');
      break;
  }
  return value;
}

function validateExportFormat(format) {
  if (!['csv', 'json'].includes(format)) throw new Error('Export format must be "csv" or "json"');
  return format;
}

function validateProfileInput(input) {
  if (!isString(input)) throw new Error('Profile input must be a string');
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new Error('Profile input cannot be empty');
  if (trimmed.length > 300) throw new Error('Profile input too long');
  // Allow SteamID64, vanity names, and steamcommunity.com URLs only
  if (trimmed.startsWith('http') && !trimmed.includes('steamcommunity.com')) {
    throw new Error('Only steamcommunity.com URLs are accepted');
  }
  return trimmed;
}

module.exports = {
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
};
