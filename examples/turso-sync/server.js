#!/usr/bin/env node
// Turso Sync Server
// Demonstrates using SchemaServer with TursoAdapter for a ready-to-use
// HTTP API that bridges browser clients to a remote Turso database.
//
// Credentials are read from `examples/turso-sync/.env`:
//   TURSO_DATABASE_URL=libsql://...turso.io
//   TURSO_AUTH_TOKEN=...
//
// Run:
//   cp examples/turso-sync/.env.example examples/turso-sync/.env  (fill in)
//   npm run example:turso

import { createClient } from '@libsql/client';
import { TursoAdapter } from 'idb-activerecord/turso-adapter';
import { SyncServer } from 'idb-activerecord/sync-server';

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
// Start the Sync Server
// ---------------------------------------------------------------------------

const server = new SyncServer({
  port: 3002,
  adapter
});

await server.init();

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

const shutdown = async () => {
  console.log('\nClosing Turso connection...');
  try {
    await adapter.disconnect();
  } catch {}
  await server.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
