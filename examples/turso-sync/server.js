#!/usr/bin/env node
// Turso Sync API Server
// ---------------------------------------------------------------------------
// A drop-in replacement for `examples/rest-sync/server.js` backed by a real
// remote Turso (libSQL) database instead of a local SQLite file.
//
// Architecture:
//   browser ──HTTP──> this server ──libSQL──> Turso Cloud
//
// This server uses `TursoAdapter` internally — REST endpoints are thin
// wrappers around `adapter.ensureTable / pull / push`. Same wire format as
// rest-sync, so the browser code is identical except for the API_URL.
//
// Credentials are read from `examples/turso-sync/.env`:
//   TURSO_DATABASE_URL=libsql://...turso.io
//   TURSO_AUTH_TOKEN=...
//
// Run:
//   cp examples/turso-sync/.env.example examples/turso-sync/.env  (fill in)
//   npm run example:turso

import http from 'node:http';
import { createClient } from '@libsql/client';
import { TursoAdapter } from '../../dist/index.js';

const PORT = Number(process.env.PORT) || 3002;
const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_URL) {
  console.error('\n❌ TURSO_DATABASE_URL is not set.');
  console.error('   Copy examples/turso-sync/.env.example to .env and fill in your credentials,');
  console.error('   then run with `npm run example:turso`.\n');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Connect to Turso using the raw @libsql/client.
// TursoAdapter automatically shims it to the internal interface.
// ---------------------------------------------------------------------------

const client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
const adapter = new TursoAdapter();
await adapter.connect({ client });
console.log(`📦 Connected to Turso: ${TURSO_URL}`);

// ---------------------------------------------------------------------------
// HTTP helpers (identical to rest-sync/server.js)
// ---------------------------------------------------------------------------

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
    req.on('data', (chunk) => {
      body += chunk;
    });
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

const TABLE_RE = /^[a-z_][a-z0-9_]*$/i;

// ---------------------------------------------------------------------------
// Routes — mirror examples/rest-sync/server.js, but every storage operation
// is delegated to TursoAdapter.
// ---------------------------------------------------------------------------

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const method = req.method;

  console.log(`${method} ${pathname}`);

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key'
    });
    res.end();
    return;
  }

  if (pathname === '/health' && method === 'GET') {
    return sendJson(res, 200, { status: 'ok', backend: 'turso', timestamp: new Date().toISOString() });
  }

  // GET /schema/:table — introspect via TursoAdapter.getRemoteSchema
  if (pathname.startsWith('/schema/') && method === 'GET') {
    const table = pathname.slice('/schema/'.length);
    if (!TABLE_RE.test(table)) return sendJson(res, 400, { error: 'Invalid table name' });
    try {
      const schema = await adapter.getRemoteSchema(table);
      return sendJson(res, 200, schema);
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // POST /schema — provision via TursoAdapter.ensureTable
  if (pathname === '/schema' && method === 'POST') {
    const body = await readBody(req);
    const table = body.table;
    if (!TABLE_RE.test(table || '')) {
      return sendJson(res, 400, { error: 'Invalid or missing table name' });
    }
    const columns = Array.isArray(body.columns) ? body.columns : [];
    if (columns.length === 0) return sendJson(res, 400, { error: 'columns array is required' });
    try {
      await adapter.ensureTable(table, columns);
      return sendJson(res, 200, { table, ensured: true });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // POST /migrations — no-op for Turso (schema handled by ensureTable)
  if (pathname === '/migrations' && method === 'POST') {
    const body = await readBody(req);
    return sendJson(res, 200, { applied: true, version: body.version, note: 'no-op for turso' });
  }

  // GET /:table — pull via TursoAdapter.pull
  const tableMatch = pathname.match(/^\/([a-z_][a-z0-9_]*)$/i)?.[1];
  if (tableMatch && method === 'GET') {
    const since = url.searchParams.get('since');
    const ownerId = url.searchParams.get('owner_id') || 'demo';
    const includeDeleted = url.searchParams.get('include_deleted') === 'true';

    try {
      const rows = await adapter.pull({
        table: tableMatch,
        since: since ? new Date(since) : undefined,
        where: { owner_id: ownerId },
        includeDeleted
      });
      return sendJson(res, 200, rows);
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // POST /:table — push via TursoAdapter.push
  if (tableMatch && method === 'POST') {
    const body = await readBody(req);
    const records = Array.isArray(body) ? body : [body];
    try {
      const result = await adapter.push(records, { table: tableMatch });
      return sendJson(res, 200, {
        pushed: result.pushed,
        rejected: result.errors.map((e, i) => ({
          id: records[i]?.id,
          reason: e.error
        }))
      });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // DELETE /:table/:id — soft delete (bump version, set deleted_at)
  const itemMatch = pathname.match(/^\/([a-z_][a-z0-9_]*)\/(\d+)$/i);
  if (itemMatch && method === 'DELETE') {
    const [, table, idStr] = itemMatch;
    const now = new Date().toISOString();
    try {
      await client.execute({
        sql: `UPDATE "${table}" SET deleted_at = ?, updatedAt = ?, version = version + 1 WHERE id = ?`,
        args: [now, now, Number(idStr)]
      });
      return sendJson(res, 200, { deleted: 1 });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  sendJson(res, 404, { error: 'Not Found', path: pathname, method });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error('Request error:', err);
    sendJson(res, 500, { error: err.message });
  });
});

server.listen(PORT, () => {
  console.log(`\n🚀 Turso Sync API running at http://localhost:${PORT}`);
  console.log(`   Backed by: ${TURSO_URL}`);
  console.log(`\nEndpoints (same wire format as rest-sync):`);
  console.log(`  GET    /health`);
  console.log(`  GET    /schema/:table`);
  console.log(`  POST   /schema`);
  console.log(`  GET    /:table`);
  console.log(`  POST   /:table`);
  console.log(`  DELETE /:table/:id`);
  console.log(`  POST   /migrations  (no-op)`);
  console.log(`\nPress Ctrl+C to stop\n`);
});

const shutdown = async () => {
  console.log('\nClosing Turso connection...');
  try {
    await adapter.disconnect();
  } catch {}
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
