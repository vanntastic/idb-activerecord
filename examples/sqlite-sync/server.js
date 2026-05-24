#!/usr/bin/env node
// REST Sync API Server
// Persists tasks to SQLite using Node's built-in node:sqlite module.
// Uses SQLiteAdapter with SyncServer for a ready-to-use HTTP API.

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SQLiteAdapter } from '../../dist/index.js';
import { SyncServer } from '../../dist/sync-server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3001;
const DB_PATH = path.join(__dirname, 'sync-demo.db');

// --- Database setup ---

const db = new DatabaseSync(DB_PATH);

// Migrations table for tracking applied migrations
db.exec(`
  CREATE TABLE IF NOT EXISTS migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )
`);

console.log(`📦 SQLite database ready at: ${DB_PATH}`);

// --- Connect adapter ---

const adapter = new SQLiteAdapter();
await adapter.connect({ client: db });

// --- Start the Sync Server ---

const server = new SyncServer({
  port: PORT,
  adapter,
  // Customize migrations endpoint to track in SQLite
  routes: {
    postMigrations: async (req, res, body) => {
      const stmt = db.prepare(
        'INSERT OR IGNORE INTO migrations (version, name, applied_at) VALUES (?, ?, ?)'
      );
      stmt.run(body.version, body.name, new Date().toISOString());
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ applied: true, version: body.version }));
    }
  }
});

await server.init();

// --- Graceful shutdown ---

const shutdown = async () => {
  console.log('\nClosing database...');
  try {
    await adapter.disconnect();
  } catch {}
  await server.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
