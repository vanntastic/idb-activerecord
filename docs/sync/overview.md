# Sync Overview

## Multi-User Sync

For multi-user / multi-device scenarios, `idb-activerecord` handles change tracking, soft deletes, and version-based conflict resolution automatically.

### Basic usage

Enable sync on your model, connect an adapter, call `db.sync()`:

```typescript
import { Database, ActiveRecord, TursoAdapter, ConflictStrategy } from 'idb-activerecord';

class Task extends ActiveRecord {
  static tableName = 'tasks';
  static enableSync = true;  // auto-tracks updatedAt, _version, change log
  static softDelete = true;  // destroy() sets _deletedAt instead of removing the row

  // Declared schema — strict source of truth for sync (see "Defining columns")
  static columns = {
    title:  { type: 'string', nullable: false },
    status: { type: 'string', default: 'pending' }
  };
}

const db = new Database('my-app');  // version auto-managed
db.registerModel(Task);
await db.connect();

const adapter = new TursoAdapter();
await adapter.connect({ url: 'https://api.example.com', endpointPattern: '/{table}' });

// Bidirectional sync: push pending changes → pull remote → merge
const result = await db.sync('tasks', adapter, {
  strategy: ConflictStrategy.LAST_WRITE_WINS,
  onProgress: (msg) => console.log(msg)
});

console.log(`Pushed ${result.pushed}, pulled ${result.pulled}, conflicts ${result.conflicts}`);
```

### Auto-sync

For most apps you don't need to call `db.sync()` manually. `db.enableAutoSync(adapter, options)` schedules a debounced sync after every CUD operation on any sync-enabled model, with optional periodic polling for remote updates:

```typescript
await adapter.connect({ url: 'https://api.example.com' });

db.enableAutoSync(adapter, {
  debounceMs: 400,        // coalesce bursts of writes
  pollIntervalMs: 5000,   // pull remote changes every 5s (omit to disable polling)
  onSync: (table, result) => console.log(`${table} synced`, result),
  onError: (table, err) => console.error(table, err)
});

// Now any CUD on a model with `static enableSync = true` triggers a sync.
await Task.create({ title: 'Buy milk' });  // sync fires ~400ms later

// To stop:
db.disableAutoSync();
```

Sync work is deferred via `requestIdleCallback` (with a 1s timeout fallback), so it doesn't compete with rendering. Models without `static enableSync = true` are ignored.

### Soft-deleted records

```typescript
const active  = await Task.all();           // excludes deleted records
const deleted = await Task.onlyDeleted();   // only deleted records
const all     = await Task.withDeleted();   // everything

await Task.restore(id);                     // undo a soft delete
```

### Advanced usage — direct SyncEngine access

`db.sync()` is a convenience wrapper. For lower-level control — inspecting the change log, resetting sync cursors, or composing custom sync flows — access the engine directly:

```typescript
import { SyncEngine } from 'idb-activerecord';

// db.getSyncEngine() returns the shared engine wired to the database
const engine = db.getSyncEngine();

// Or create and wire your own
const engine = new SyncEngine();
engine.setDatabase(db.getDB());

// Inspect pending changes before pushing
const count = await engine.getPendingCount('tasks');

// Push and pull as separate steps
await engine.pushChanges('tasks', adapter);
const remote = await engine.pullChanges('tasks', adapter);
await engine.mergeChanges('tasks', remote, adapter, ConflictStrategy.LOCAL_WINS);

// Reset sync state for a table (forces full re-pull on next sync)
await engine.clearSyncData('tasks');
```

### How it works

- **Change tracking** — every `create`/`update`/`destroy` on a sync-enabled model appends to an internal `__sync_changes` store
- **Version stamps** — each record gets `_version` (integer) and `updatedAt` fields, incremented on every write
- **Soft deletes** — `destroy()` sets `_deletedAt` so deletions propagate as tombstones to other devices
- **Cursor tracking** — `__sync_meta` persists `lastPullAt` per table so pulls only fetch what changed since last sync
- **Conflict resolution** — newer `_version` wins for regular records; ties fall back to `updatedAt`. For remote tombstones with pending local changes, the adapter uses the selected [conflict strategy](/sync/conflict-resolution).

See [`examples/sqlite-sync`](https://github.com/vanntastic/idb-activerecord/tree/main/examples/sqlite-sync) for a runnable multi-user demo with a SQLite backend.
