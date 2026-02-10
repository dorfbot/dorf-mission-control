#!/usr/bin/env node
// Helper script to read portfolio data for Dorf
const Database = require('better-sqlite3');
const path = require('path');

// Resolve from script location
const dbPath = path.resolve(__dirname, '..', 'data', 'mission-control.db');
console.log('Reading from:', dbPath);

const db = new Database(dbPath);

// Show all tables
console.log('\n=== Database Tables ===');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log(tables.map(t => t.name).join(', '));

console.log('\n=== Crypto Portfolio ===');
try {
  const crypto = db.prepare('SELECT * FROM portfolio').all();
  if (crypto.length === 0) {
    console.log('No crypto holdings found.');
  } else {
    console.table(crypto);
  }
} catch (e) {
  console.log('Error:', e.message);
}

console.log('\n=== Traditional Portfolio ===');
try {
  const traditional = db.prepare('SELECT * FROM portfolio_traditional').all();
  if (traditional.length === 0) {
    console.log('No traditional portfolio entries found.');
  } else {
    console.table(traditional);
  }
} catch (e) {
  console.log('Table does not exist yet:', e.message);
}

db.close();
