#!/usr/bin/env node
'use strict';

// Downloads Chart.js bundle into renderer/ so it can be served locally
// without needing a CDN (satisfying our strict CSP).
// Run: node scripts/download-chartjs.js

const https = require('https');
const fs = require('fs');
const path = require('path');

const CHARTJS_URL = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js';
const DEST = path.join(__dirname, '..', 'renderer', 'chart.min.js');

console.log('Downloading Chart.js…');

const file = fs.createWriteStream(DEST);
https.get(CHARTJS_URL, (res) => {
  if (res.statusCode !== 200) {
    console.error(`Failed: HTTP ${res.statusCode}`);
    process.exit(1);
  }
  res.pipe(file);
  file.on('finish', () => {
    file.close();
    console.log(`Saved to ${DEST}`);
  });
}).on('error', (err) => {
  fs.unlink(DEST, () => {});
  console.error('Error:', err.message);
  process.exit(1);
});
