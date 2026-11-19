# SQLite Adapter

`SQLiteAdapter` syncs to a SQLite database. It supports two modes:

**Direct client mode (server-side):** Use Node.js's built-in `node:sqlite` module (`DatabaseSync`):

```typescript
import { DatabaseSync } from 'node:sqlite';
import { SQLiteAdapter } from 'idb-activerecord/sqlite-adapter';

const db = new DatabaseSync('app.db');
const adapter = new SQLiteAdapter();
await adapter.connect({ client: db });
```

**HTTP mode (browser-side):** Use `url`/`endpointPattern` to talk to a `SyncServer` instance:

```typescript
import { SQLiteAdapter } from 'idb-activerecord';

const adapter = new SQLiteAdapter();
await adapter.connect({
  url: 'http://localhost:3001',
  endpointPattern: '/{table}'
});
```

Same feature set as `TursoAdapter`: `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN`, version-based optimistic concurrency, and tombstone propagation.
