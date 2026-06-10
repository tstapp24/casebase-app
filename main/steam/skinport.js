'use strict';

const https = require('https');
const zlib = require('zlib');

// Skinport public items endpoint — returns all CS2 market prices in one response.
// Requires Accept-Encoding: br (Brotli). No explicit rate-limit headers are sent,
// but their docs recommend no more than once per 5 minutes.
const SKINPORT_ITEMS_URL = 'https://api.skinport.com/v1/items?app_id=730&currency=USD&tradable=0';
const MIN_FETCH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let lastFetchMs = 0;
let inflight = null; // deduplicate concurrent callers

function fetchSkinportItems() {
  // Return in-flight promise if one is already running
  if (inflight) return inflight;

  // Respect the 5-minute cache window
  if (Date.now() - lastFetchMs < MIN_FETCH_INTERVAL_MS) {
    return Promise.resolve(null); // signal: use local cache, no fetch needed
  }

  inflight = new Promise((resolve, reject) => {
    const req = https.get(SKINPORT_ITEMS_URL, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'br',
        'User-Agent': 'CaseBase/1.0 (github.com/tstapp24/casebase-app)',
      },
      timeout: 30000,
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Skinport API returned HTTP ${res.statusCode}`));
        return;
      }

      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        zlib.brotliDecompress(buf, (err, result) => {
          if (err) { reject(new Error(`Skinport Brotli decompress failed: ${err.message}`)); return; }
          try {
            resolve(JSON.parse(result.toString('utf8')));
          } catch (parseErr) {
            reject(new Error(`Skinport JSON parse failed: ${parseErr.message}`));
          }
        });
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Skinport request timed out')); });
  }).then(items => {
    lastFetchMs = Date.now();
    inflight = null;
    return items;
  }).catch(err => {
    inflight = null;
    throw err;
  });

  return inflight;
}

module.exports = { fetchSkinportItems };
