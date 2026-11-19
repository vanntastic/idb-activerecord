# Turso Adapter

`TursoAdapter` syncs to a Turso/libSQL/SQLite database. It supports two modes:

**Direct client mode (server-side):** Pass a raw `@libsql/client` instance — the adapter handles shimming internally:

```typescript
import { createClient } from '@libsql/client';
import { TursoAdapter } from 'idb-activerecord/turso-adapter';

const client = createClient({ url: 'libsql://my-db.turso.io', authToken: '...' });
const adapter = new TursoAdapter();
await adapter.connect({ client });

// Use this adapter with SyncServer or another server-side sync integration.
```

**HTTP mode (browser-side):** Use `url`/`endpointPattern` to talk to a `SyncServer` instance:

```typescript
import { Database, ActiveRecord, TursoAdapter } from 'idb-activerecord';

const db = new Database('my-app');
db.registerModel(Task);
await db.connect();

// HTTP mode (browser-side) - talks to SyncServer
const adapter = new TursoAdapter();
await adapter.connect({
  url: 'http://localhost:3002',
  endpointPattern: '/{table}'
});

db.enableAutoSync(adapter, { debounceMs: 500, pollIntervalMs: 5000 });
```

For custom clients (e.g. `@tursodatabase/database`, `better-sqlite3`), implement the `TursoClient` interface (`prepare(sql).run/all`) and pass it to `connect()`. See the adapter source for the interface definition.

The adapter handles `CREATE TABLE IF NOT EXISTS` provisioning, `ALTER TABLE ADD COLUMN` for new fields, version-based optimistic concurrency, and tombstone propagation via the `deleted_at` column. It maps the SyncEngine wire fields `_version` / `_deletedAt` to the SQL columns `version` / `deleted_at`.
