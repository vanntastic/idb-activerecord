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

// Models are the source of truth - tables created on first sync via POST /schema
db.exec(`
  CREATE TABLE IF NOT EXISTS migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )
`);

console.log(`📦 SQLite database ready at: ${DB_PATH}`);
console.log(`📋 Tables created on-demand via POST /schema (schema-on-demand)`);

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

  // Schema: GET — dynamic introspection from SQLite
  if (pathname.startsWith('/schema/') && method === 'GET') {
    const table = pathname.slice('/schema/'.length);
    if (!table || !/^[a-z_][a-z0-9_]*$/i.test(table)) {
      return sendJson(res, 400, { error: 'Invalid table name' });
    }

    const exists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
    ).get(table);
    if (!exists) {
      return sendJson(res, 404, { error: `Table '${table}' not found` });
    }

    // Read actual columns from SQLite
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(col => ({
      name: col.name,
      type: col.type === 'INTEGER' ? 'integer' : 'string',
      nullable: !col.notnull,
      default: col.dflt_value
    }));

    // Read indexes
    const indexes = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=?`
    ).all(table).map(idx => ({ name: idx.name }));

    return sendJson(res, 200, { name: table, columns, indexes });
  }

  // Schema: POST — create table from columns spec, OR ALTER to add missing columns.
  // The client (sync engine + adapter) is the source of truth for all columns,
  // including sync protocol meta columns. This endpoint just translates the
  // ColumnDef spec into SQL DDL.
  if (pathname === '/schema' && method === 'POST') {
    const body = await readBody(req);
    const table = body.table;
    if (!table || !/^[a-z_][a-z0-9_]*$/i.test(table)) {
      return sendJson(res, 400, { error: 'Invalid or missing table name' });
    }

    const reserved = ['migrations'];
    if (reserved.includes(table)) {
      return sendJson(res, 400, { error: `Table '${table}' is reserved` });
    }

    const columns = body.columns || [];
    if (!Array.isArray(columns) || columns.length === 0) {
      return sendJson(res, 400, { error: 'columns array is required' });
    }

    // Translate ColumnDef -> SQL column definition
    const toSqlType = (t) => {
      if (t === 'integer' || t === 'boolean') return 'INTEGER';
      return 'TEXT';
    };
    const formatDefault = (val, type) => {
      if (val === undefined || val === null) return '';
      if (typeof val === 'string') return ` DEFAULT '${val.replace(/'/g, "''")}'`;
      if (typeof val === 'number' || typeof val === 'boolean') return ` DEFAULT ${Number(val)}`;
      return '';
    };
    const toSqlDdl = (col) => {
      const parts = [`${col.name} ${toSqlType(col.type)}`];
      if (col.primaryKey) parts.push('PRIMARY KEY');
      if (col.autoIncrement) parts.push('AUTOINCREMENT');
      if (col.nullable === false && !col.primaryKey) parts.push('NOT NULL');
      const def = formatDefault(col.default, col.type);
      if (def) parts.push(def.trim());
      return parts.join(' ');
    };

    const exists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
    ).get(table);

    if (!exists) {
      const colsSql = columns.map(toSqlDdl).join(', ');
      db.exec(`CREATE TABLE ${table} (${colsSql})`);
      console.log(`🆕 Created table: ${table} (${columns.length} columns)`);
      return sendJson(res, 200, { created: true, altered: [], table });
    }

    // Table exists — ALTER to add any missing columns (excluding PK)
    const existingCols = new Set(
      db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)
    );
    const altered = [];
    for (const col of columns) {
      if (existingCols.has(col.name) || col.primaryKey) continue;
      try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${toSqlDdl(col)}`);
        altered.push(col.name);
        console.log(`🔧 Added column ${col.name} to ${table}`);
      } catch (err) {
        // Column may have been added by a concurrent request; ignore
      }
    }
    return sendJson(res, 200, { created: false, altered, table });
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

  // Generic table handlers handle all models (tasks, notes, labels, etc.)
  // Tables are created on-demand via POST /schema before first sync

  // Generic table: GET (pull)
  const genericTable = pathname.match(/^\/([a-z_][a-z0-9_]*)$/i)?.[1];
  if (genericTable && method === 'GET') {
    const tableExists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
    ).get(genericTable);
    if (!tableExists) return sendJson(res, 404, { error: `Table '${genericTable}' not found` });

    const since = url.searchParams.get('since');
    const ownerId = url.searchParams.get('owner_id') || 'demo';
    const includeDeleted = url.searchParams.get('include_deleted') === 'true';

    const conditions = ['owner_id = ?'];
    const params = [ownerId];
    if (since) { conditions.push('updatedAt > ?'); params.push(since); }
    if (!includeDeleted) { conditions.push('deleted_at IS NULL'); }

    const rows = db.prepare(
      `SELECT * FROM ${genericTable} WHERE ${conditions.join(' AND ')} ORDER BY id ASC`
    ).all(...params);

    return sendJson(res, 200, rows.map(r => ({
      ...r,
      _version: r.version,
      _deletedAt: r.deleted_at,
    })));
  }

  // Generic table: POST (push — upsert)
  if (genericTable && method === 'POST') {
    const tableExists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
    ).get(genericTable);
    if (!tableExists) return sendJson(res, 404, { error: `Table '${genericTable}' not found` });

    const body = await readBody(req);
    const records = Array.isArray(body) ? body : [body];
    let pushed = 0;
    const rejected = [];
    const now = new Date().toISOString();

    // Get column names for this table (excluding sync meta columns).
    // Schema must already be set up via POST /schema before pushing.
    const cols = db.prepare(`PRAGMA table_info(${genericTable})`).all();
    const userColNames = cols
      .map(c => c.name)
      .filter(n => !['id', 'updatedAt', 'version', 'deleted_at', 'owner_id'].includes(n));

    for (const record of records) {
      const incomingVersion = record._version || 1;
      const deletedAt = record._deletedAt || null;
      const ownerId = record.owner_id || 'demo';

      const userVals = userColNames.map(n => record[n] ?? null);
      const allCols = [...userColNames, 'updatedAt', 'version', 'deleted_at', 'owner_id'];
      const allVals = [...userVals, record.updatedAt || now, incomingVersion, deletedAt, ownerId];

      if (record.id) {
        const existing = db.prepare(`SELECT version FROM ${genericTable} WHERE id = ?`).get(record.id);
        if (existing && existing.version > incomingVersion) {
          rejected.push({ id: record.id, reason: 'version_conflict', serverVersion: existing.version });
          continue;
        }
        const setClauses = allCols.map(c => `${c} = excluded.${c}`).join(', ');
        db.prepare(`
          INSERT INTO ${genericTable} (id, ${allCols.join(', ')})
          VALUES (?, ${allCols.map(() => '?').join(', ')})
          ON CONFLICT(id) DO UPDATE SET ${setClauses}
        `).run(record.id, ...allVals);
      } else {
        db.prepare(
          `INSERT INTO ${genericTable} (${allCols.join(', ')}) VALUES (${allCols.map(() => '?').join(', ')})`
        ).run(...allVals);
      }
      pushed++;
    }
    return sendJson(res, 200, { pushed, rejected });
  }

  // Generic table: DELETE (single — soft delete)
  const genericItemMatch = pathname.match(/^\/([a-z_][a-z0-9_]*)\/(\d+)$/i);
  if (genericItemMatch && method === 'DELETE') {
    const [, gTable, gId] = genericItemMatch;
    const now = new Date().toISOString();
    db.prepare(`UPDATE ${gTable} SET deleted_at = ?, updatedAt = ?, version = version + 1 WHERE id = ?`)
      .run(now, now, Number(gId));
    return sendJson(res, 200, { deleted: 1 });
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
  console.log(`\nSchema-on-demand: Models define tables, server creates them on first sync`);
  console.log(`\nEndpoints:`);
  console.log(`  GET    /health`);
  console.log(`  GET    /schema/:table   (get schema for any table)`);
  console.log(`  POST   /schema          (create table on-demand)`);
  console.log(`  GET    /:table          (pull any table: tasks, notes, labels, ...)`);
  console.log(`  POST   /:table          (push/upsert to any table)`);
  console.log(`  DELETE /:table/:id     (soft delete any record)`);
  console.log(`  POST   /migrations      (body: { version, name })`);
  console.log(`\nPress Ctrl+C to stop\n`);
});

process.on('SIGINT', () => {
  console.log('\nClosing database...');
  db.close();
  process.exit(0);
});
