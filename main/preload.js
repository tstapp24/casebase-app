'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Explicit allowlist of IPC channels the renderer may invoke
const INVOKE_CHANNELS = new Set([
  'steam:login',
  'steam:logout',
  'auth:get-current-user',
  'apikey:save',
  'apikey:has',
  'apikey:clear',
  'inventory:refresh',
  'inventory:get',
  'prices:fetch-batch',
  'prices:history',
  'alerts:create',
  'alerts:list',
  'alerts:delete',
  'alerts:toggle',
  'prefs:get',
  'prefs:set',
  'export:inventory',
  'profiles:add',
  'profiles:list',
  'profiles:remove',
  'profiles:refresh-inventory',
  'profiles:get-inventory',
  'portfolio:snapshot',
  'portfolio:history',
]);

// Channels main → renderer may push events on
const RECEIVE_CHANNELS = new Set([
  'prices:progress',
  'alerts:triggered',
]);

contextBridge.exposeInMainWorld('api', {
  invoke(channel, ...args) {
    if (!INVOKE_CHANNELS.has(channel)) {
      throw new Error(`Blocked IPC channel: ${channel}`);
    }
    return ipcRenderer.invoke(channel, ...args);
  },

  on(channel, listener) {
    if (!RECEIVE_CHANNELS.has(channel)) {
      throw new Error(`Blocked receive channel: ${channel}`);
    }
    const wrapped = (_event, ...args) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    // Return a cleanup function
    return () => ipcRenderer.removeListener(channel, wrapped);
  },

  once(channel, listener) {
    if (!RECEIVE_CHANNELS.has(channel)) {
      throw new Error(`Blocked receive channel: ${channel}`);
    }
    ipcRenderer.once(channel, (_event, ...args) => listener(...args));
  },
});
