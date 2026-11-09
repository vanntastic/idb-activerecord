# Sync Server

`SyncServer` is a ready-to-use HTTP server for sync adapters. It provides REST endpoints for schema operations, pull/push, and soft deletes. Adapter-agnostic — works with any sync adapter.

**Note:** `SyncServer` is Node.js-only and must be imported directly:

```typescript
import { createClient } from '@libsql/client';
import { TursoAdapter } from 'idb-activerecord/turso-adapter';
import { SyncServer } from 'idb-activerecord/sync-server';

const client = createClient({ url: 'libsql://my-db.turso.io', authToken });
const adapter = new TursoAdapter();
await adapter.connect({ client });

const server = new SyncServer({
  port: 3002,
  adapter,
  // Optional: customize routes
  routes: {
    health: async (req, res) => {
      // Custom health check
    }
  }
});

await server.init();
```

**Endpoints:**
- `GET /health` — health check
- `GET /schema/:table` — get table schema
- `POST /schema` — create/alter table
- `GET /:table` — pull records (supports `since`, `owner_id`, `include_deleted` query params)
- `POST /:table` — push records
- `DELETE /:table/:id` — soft delete
- `POST /migrations` — migrations (no-op by default)
