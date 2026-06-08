#!/usr/bin/env node
'use strict';

// Standalone DB initialiser for development.
// Usage: node --experimental-sqlite main/db/init.js
// (The --experimental-sqlite flag is only needed on Node.js 22; Node 23+ and Electron 42 don't need it.)

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', '..', 'dev.db');
const schemaPath = path.join(__dirname, '..', '..', 'db', 'schema.sql');

const schema = fs.readFileSync(schemaPath, 'utf8');
const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec(schema);
db.close();

console.log(`Database initialised at: ${dbPath}`);
