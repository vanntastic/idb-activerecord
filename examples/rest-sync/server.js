#!/usr/bin/env node
// REST Sync API Server
// Persists tasks to SQLite using Node's built-in node:sqlite module
// Now supports multi-user sync with versioning, soft deletes, and owner isolation.

import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3001;
const DB_PATH = path.join(__dirname, 'sync-demo.db');

// --- Database setup ---

const db = new DatabaseSync(DB_PATH);

// Create base table
db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    updatedAt TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    deleted_at TEXT,
    owner_id TEXT DEFAULT 'demo'
  )
`);

// Add columns if migrating from older schema
try { db.exec('ALTER TABLE tasks ADD COLUMN version INTEGER DEFAULT 1'); } catch {}
try { db.exec('ALTER TABLE tasks ADD COLUMN deleted_at TEXT'); } catch {}
try { db.exec('ALTER TABLE tasks ADD COLUMN owner_id TEXT DEFAULT \'demo\''); } catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )
`);

console.log(`📦 SQLite database initialized at: ${DB_PATH}`);

// --- Helpers ---

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key'
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// --- Routes ---

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const method = req.method;

  console.log(`${method} ${pathname}`);

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key'
    });
    res.end();
    return;
  }

  // Health check
  if (pathname === '/health' && method === 'GET') {
    return sendJson(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
  }

  // Schema
  if (pathname.startsWith('/schema/') && method === 'GET') {
    const table = pathname.slice('/schema/'.length);
    if (table === 'tasks') {
      return sendJson(res, 200, {
        name: 'tasks',
        columns: [
          { name: 'id', type: 'integer', nullable: false },
          { name: 'title', type: 'string', nullable: false },
          { name: 'status', type: 'string', nullable: true },
          { name: 'updatedAt', type: 'datetime', nullable: true },
          { name: 'version', type: 'integer', nullable: false },
          { name: 'deleted_at', type: 'datetime', nullable: true },
          { name: 'owner_id', type: 'string', nullable: true }
        ],
        indexes: [
          { name: 'pk', columns: ['id'], unique: true }
        ]
      });
    }
    return sendJson(res, 404, { error: `Unknown table: ${table}` });
  }

  // Migrations
  if (pathname === '/migrations' && method === 'POST') {
    const body = await readBody(req);
    const stmt = db.prepare(
      'INSERT OR IGNORE INTO migrations (version, name, applied_at) VALUES (?, ?, ?)'
    );
    stmt.run(body.version, body.name, new Date().toISOString());
    return sendJson(res, 200, { applied: true, version: body.version });
  }

  // Tasks: GET (pull)
  if (pathname === '/tasks' && method === 'GET') {
    const since = url.searchParams.get('since');
    const limit = url.searchParams.get('limit');
    const offset = url.searchParams.get('offset');
    const ownerId = url.searchParams.get('owner_id') || 'demo';
    const includeDeleted = url.searchParams.get('include_deleted') === 'true';

    let sql = 'SELECT id, title, status, updatedAt, version, deleted_at, owner_id FROM tasks';
    const params = [];
    const conditions = [];

    // Always scope to owner
    conditions.push('owner_id = ?');
    params.push(ownerId);

    if (since) {
      conditions.push('updatedAt > ?');
      params.push(since);
    }

    if (!includeDeleted) {
      conditions.push('deleted_at IS NULL');
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY id ASC';

    if (limit) {
      sql += ' LIMIT ?';
      params.push(Number(limit));

      if (offset) {
        sql += ' OFFSET ?';
        params.push(Number(offset));
      }
    }

    const rows = db.prepare(sql).all(...params);

    // Map deleted_at -> _deletedAt for client compatibility
    const mapped = rows.map(r => ({
      id: r.id,
      title: r.title,
      status: r.status,
      updatedAt: r.updatedAt,
      _version: r.version,
      _deletedAt: r.deleted_at,
      owner_id: r.owner_id
    }));

    return sendJson(res, 200, mapped);
  }

  // Tasks: POST (push - upsert with version checking)
  if (pathname === '/tasks' && method === 'POST') {
    const body = await readBody(req);
    const records = Array.isArray(body) ? body : [body];

    let pushed = 0;
    const rejected = [];
    const now = new Date().toISOString();

    const insert = db.prepare(`
      INSERT INTO tasks (title, status, updatedAt, version, deleted_at, owner_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const record of records) {
      const incomingVersion = record._version || 1;
      const deletedAt = record._deletedAt || null;
      const ownerId = record.owner_id || 'demo';

      if (record.id) {
        // Check existing record for version conflict
        const existing = db.prepare('SELECT version FROM tasks WHERE id = ?').get(record.id);

        if (existing && existing.version > incomingVersion) {
          rejected.push({ id: record.id, reason: 'version_conflict', serverVersion: existing.version });
          continue;
        }

        // Upsert with version
        db.prepare(`
          INSERT INTO tasks (id, title, status, updatedAt, version, deleted_at, owner_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            status = excluded.status,
            updatedAt = excluded.updatedAt,
            version = excluded.version,
            deleted_at = excluded.deleted_at,
            owner_id = excluded.owner_id
        `).run(
          record.id,
          record.title,
          record.status || 'pending',
          record.updatedAt || now,
          incomingVersion,
          deletedAt,
          ownerId
        );
      } else {
        insert.run(
          record.title,
          record.status || 'pending',
          record.updatedAt || now,
          incomingVersion,
          deletedAt,
          ownerId
        );
      }
      pushed++;
    }

    return sendJson(res, 200, { pushed, rejected });
  }

  // Tasks: DELETE (single) — soft delete
  const taskMatch = pathname.match(/^\/tasks\/(\d+)$/);
  if (taskMatch && method === 'DELETE') {
    const id = Number(taskMatch[1]);
    const now = new Date().toISOString();
    db.prepare('UPDATE tasks SET deleted_at = ?, updatedAt = ?, version = version + 1 WHERE id = ?').run(now, now, id);
    return sendJson(res, 200, { deleted: 1 });
  }

  // Tasks: clear all (for demo convenience)
  if (pathname === '/tasks' && method === 'DELETE') {
    const result = db.prepare('DELETE FROM tasks').run();
    return sendJson(res, 200, { deleted: result.changes });
  }

  sendJson(res, 404, { error: 'Not Found', path: pathname, method });
}

// --- Server ---

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(err => {
    console.error('Request error:', err);
    sendJson(res, 500, { error: err.message });
  });
});

server.listen(PORT, () => {
  console.log(`\n🚀 REST Sync API running at http://localhost:${PORT}`);
  console.log(`\nEndpoints:`);
  console.log(`  GET    /health`);
  console.log(`  GET    /schema/tasks`);
  console.log(`  GET    /tasks?since=&limit=&offset=&owner_id=&include_deleted=`);
  console.log(`  POST   /tasks           (body: array of records with _version, _deletedAt)`);
  console.log(`  DELETE /tasks           (hard clear all)`);
  console.log(`  DELETE /tasks/:id       (soft delete)`);
  console.log(`  POST   /migrations      (body: { version, name })`);
  console.log(`\nPress Ctrl+C to stop\n`);
});

process.on('SIGINT', () => {
  console.log('\nClosing database...');
  db.close();
  process.exit(0);
});
