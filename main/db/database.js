'use strict';

const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { DatabaseSync } = require('node:sqlite');

let db = null;

function getDbPath() {
  const userData = app.getPath('userData');
  return path.join(userData, 'casebase.db');
}

function initDatabase() {
  if (db) return db;

  const dbPath = getDbPath();
  db = new DatabaseSync(dbPath);

  // Performance pragmas
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA temp_store = MEMORY');

  // Apply schema
  const schemaPath = path.join(__dirname, '..', '..', 'db', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);

  // Migrations — idempotent ALTER TABLE calls for existing databases
  try {
    db.exec("ALTER TABLE price_history ADD COLUMN source TEXT NOT NULL DEFAULT 'steam'");
  } catch (_) { /* column already exists */ }

  return db;
}

function getDatabase() {
  if (!db) return initDatabase();
  return db;
}

function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { initDatabase, getDatabase, closeDatabase };
