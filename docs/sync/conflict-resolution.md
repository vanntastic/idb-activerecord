# Conflict Resolution

When merging regular records, the sync engine compares `_version` first; if versions match, the newer `updatedAt` wins. Remote tombstones with pending local changes are resolved through the adapter using the selected strategy.

`db.sync()` defaults to `ConflictStrategy.LAST_WRITE_WINS`. The built-in adapter resolver also supports `LOCAL_WINS`, `REMOTE_WINS`, and `CUSTOM`. For `LAST_WRITE_WINS`, the resolver compares `updatedAt` and chooses the remote record on a tie.

To supply a custom resolver for adapters derived from `BaseAdapter`:

```typescript
import { ConflictStrategy } from 'idb-activerecord';

adapter.setConflictResolver(async (local, remote) => {
  // Return the record that should win.
  return local;
});

await db.sync('tasks', adapter, { strategy: ConflictStrategy.CUSTOM });
```

Without a custom resolver, `CUSTOM` falls back to the local record. See [Sync Overview](/sync/overview) for setup and [Custom Adapters](/sync/custom-adapters) for the lower-level adapter API.
