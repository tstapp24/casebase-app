'use strict';

const { BrowserWindow } = require('electron');
const openid = require('openid');

const STEAM_OPENID_URL = 'https://steamcommunity.com/openid';

// This URL is sent to Steam as the return_to parameter.
// Steam redirects back to it after login — we intercept the redirect inside
// Electron before the browser ever loads it, so no HTTP server is needed.
const CALLBACK_URL = 'http://localhost:19583/auth/steam/callback';

function extractSteamId(identityUrl) {
  const match = identityUrl.match(/\/openid\/id\/(\d+)$/);
  if (!match) throw new Error('Could not extract SteamID from identity URL');
  const steamId = match[1];
  if (!/^\d{17}$/.test(steamId)) throw new Error('Invalid SteamID format');
  return steamId;
}

function createRelyingParty() {
  return new openid.RelyingParty(
    CALLBACK_URL,
    null,   // realm — derived from return URL
    true,   // stateless
    false,  // strict
    []
  );
}

function steamLogin() {
  return new Promise((resolve, reject) => {
    const relyingParty = createRelyingParty();

    relyingParty.authenticate(STEAM_OPENID_URL, false, (err, authUrl) => {
      if (err) return reject(new Error(`OpenID authenticate error: ${err.message}`));
      if (!authUrl) return reject(new Error('No auth URL returned from OpenID'));

      let authWindow = null;
      let settled = false;

      function settle(fn) {
        if (settled) return;
        settled = true;
        if (authWindow && !authWindow.isDestroyed()) authWindow.close();
        fn();
      }

      function handleCallback(callbackUrl) {
        relyingParty.verifyAssertion(callbackUrl, (verifyErr, result) => {
          if (verifyErr) {
            return settle(() => reject(new Error(`Verification failed: ${verifyErr.message}`)));
          }
          if (!result.authenticated) {
            return settle(() => reject(new Error('Steam authentication not confirmed')));
          }
          try {
            const steamId = extractSteamId(result.claimedIdentifier);
            settle(() => resolve({ steamId, claimedIdentifier: result.claimedIdentifier }));
          } catch (e) {
            settle(() => reject(e));
          }
        });
      }

      authWindow = new BrowserWindow({
        width: 800,
        height: 650,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
        title: 'Sign in via Steam',
        autoHideMenuBar: true,
      });

      // Steam sends a 302 redirect to our CALLBACK_URL after the user signs in.
      // Intercept it here before Electron tries to navigate (which main.js would block).
      authWindow.webContents.on('will-redirect', (event, url) => {
        if (url.startsWith(CALLBACK_URL)) {
          event.preventDefault();
          handleCallback(url);
        }
      });

      // Fallback: some paths through the Steam login flow use JS navigation
      // instead of a server-side redirect, so will-redirect doesn't fire.
      authWindow.webContents.on('will-navigate', (event, url) => {
        if (url.startsWith(CALLBACK_URL)) {
          event.preventDefault();
          handleCallback(url);
        }
      });

      authWindow.loadURL(authUrl);

      authWindow.on('closed', () => {
        if (!settled) settle(() => reject(new Error('Authentication window closed by user')));
      });

      // 3-minute timeout
      setTimeout(() => settle(() => reject(new Error('Authentication timed out'))), 180_000);
    });
  });
}

module.exports = { steamLogin };
