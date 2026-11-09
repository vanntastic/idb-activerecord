# Custom Adapters

## Low-level usage

If you need to call an adapter directly (instead of going through `SyncEngine`):

```typescript
import { TursoAdapter } from 'idb-activerecord';

const adapter = new TursoAdapter();
await adapter.connect({
  url: 'https://api.example.com',
  endpointPattern: '/{table}'
});

// Provision the remote table (idempotent — SyncEngine calls this for you)
await adapter.ensureTable('tasks', Task.getColumnDefs() ?? []);

// Pull remote changes since a cursor
const remoteTasks = await adapter.pull<Task>({ table: 'tasks', since: lastSync });

// Push ActiveRecord instances (must have a `tableName` — plain objects need `options.table`)
const result = await adapter.push([task1, task2]);

// Per-record conflict resolution
const winner = await adapter.resolveConflict(localTask, remoteTask, ConflictStrategy.LAST_WRITE_WINS);
```

Note that calling `adapter.push()` directly **bypasses** the SyncEngine — no change-log entries are consumed, no `_version` is incremented, and no `updatedAt` is stamped. Use `db.sync()` if you want those guarantees.

## Building a custom adapter

Extend `BaseAdapter` and implement the abstract methods:

```typescript
import {
  BaseAdapter,
  AdapterConfig,
  SyncQuery,
  PushOptions,
  SyncResult,
  TableSchema,
  SyncMigration,
  ColumnDef,
  ActiveRecord
} from 'idb-activerecord';

class MyAdapter extends BaseAdapter {
  async connect(config: AdapterConfig): Promise<void> {
    this.config = config;
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async pull<T extends ActiveRecord>(query: SyncQuery): Promise<T[]> {
    // Fetch records from your backend. Honor query.since (cursor),
    // query.where (filters), and query.includeDeleted (tombstones).
    return [];
  }

  async push<T extends ActiveRecord>(records: T[], options?: PushOptions): Promise<SyncResult> {
    // Send records to your backend. Use options?.table when records are plain objects.
    return { pushed: records.length, pulled: 0, conflicts: 0, errors: [], timestamp: new Date() };
  }

  async ensureTable(table: string, columns?: ColumnDef[]): Promise<void> {
    // Create or migrate the remote table to match `columns`.
    // SyncEngine calls this before every push/pull cycle.
  }

  async getRemoteSchema(table: string): Promise<TableSchema> {
    return { name: table, columns: [], indexes: [] };
  }

  async applyMigration(migration: SyncMigration): Promise<void> {
    // Optional — forward migration intent to your backend.
  }
}
```
