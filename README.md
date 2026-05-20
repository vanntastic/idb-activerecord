# IDB ActiveRecord

A modern, type-safe ActiveRecord-style API for IndexedDB in JavaScript and TypeScript.

## Overview

IDB ActiveRecord provides a clean, intuitive interface for working with IndexedDB, abstracting away the complexity of the native IndexedDB API while maintaining its power and performance. Inspired by Ruby's ActiveRecord pattern, this library makes browser-based data persistence simple and elegant.

## Features

- **ActiveRecord Pattern**: Model-based API with familiar CRUD operations
- **TypeScript Support**: Full type safety with generics and interfaces
- **Promise-based**: Modern async/await API
- **Query Builder**: Chainable query methods for complex data retrieval
- **Relationships**: Support for hasOne, hasMany, and belongsTo associations
- **Migrations**: TableBuilder for schema definition with automatic object store creation
- **Transactions**: Automatic transaction management with beginTransaction for manual control
- **Callbacks**: beforeCreate, afterCreate, beforeUpdate, afterUpdate, beforeDestroy, afterDestroy
- **Validation**: Built-in validation rules for presence, length, and format
- **Sync Adapters**: Pluggable sync with REST APIs and cloud databases (Turso, Supabase planned)
- **Lightweight**: Zero dependencies, small bundle size
- **Browser Support**: Works in all modern browsers with IndexedDB support

## Installation

**npm / yarn / pnpm**

```bash
npm install idb-activerecord
# or
yarn add idb-activerecord
# or
pnpm add idb-activerecord
```

**CDN (via jsDelivr)**

```html
<script src="https://cdn.jsdelivr.net/npm/idb-activerecord@1.0.0/dist/idb-activerecord.min.js"></script>
```

All exports are available under the global `IDBActiveRecord` object:

```html
<script>
  const { Database, ActiveRecord } = IDBActiveRecord;
</script>
```

## Quick Start

### With npm (TypeScript / ESM)

```typescript
import { ActiveRecord, Database } from 'idb-activerecord';

// Define your model
interface User {
  id?: number;
  name: string;
  email: string;
  age: number;
}

// Create a model class with a declared schema
class User extends ActiveRecord<User> {
  static tableName = 'users';

  static columns = {
    name:  { type: 'string',  nullable: false },
    email: { type: 'string',  nullable: false },
    age:   { type: 'integer', default: 0 }
  };
}

// Initialize the database
const db = new Database('my-app');
db.registerModel(User);
await db.connect();

// Create a record
const user = await User.create({
  name: 'John Doe',
  email: 'john@example.com',
  age: 30
});

// Find a record
const foundUser = await User.find(1);

// Update a record
await user.update({ age: 31 });

// Delete a record
await user.destroy();

// Query with conditions
const adults = await User.where('age', '>=', 18).all();
```

### With CDN (plain HTML)

View this example in [CodeSandbox](https://codesandbox.io/p/sandbox/cqjngw)

```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.jsdelivr.net/npm/idb-activerecord@1.0.1/dist/idb-activerecord.min.js"></script>
</head>
<body>
  <p>To view the database: open your devTools > Application > IndexedDB > my-app > users</p>
  <ul id="user-list"></ul>
  <button id="clear-btn">Clear Database</button>

  <script>
    const { ActiveRecord, Database } = IDBActiveRecord;

    class User extends ActiveRecord {
      static tableName = 'users';

      static columns = {
        name:  { type: 'string',  nullable: false },
        email: { type: 'string',  nullable: false },
        age:   { type: 'integer', default: 0 }
      };
    }

    const db = new Database('my-app');
    db.registerModel(User);

    async function renderUsers() {
      const users = await User.where('age', '>=', 18).all();
      const list = document.getElementById('user-list');
      list.innerHTML = '';
      users.forEach(user => {
        const li = document.createElement('li');
        li.textContent = `${user.name} (${user.email}) — age ${user.age}`;
        list.appendChild(li);
      });
    }

    db.connect().then(async () => {
      await User.create({ name: 'John Doe', email: 'john@example.com', age: 30 });
      await User.create({ name: 'Jane Smith', email: 'jane@example.com', age: 25 });

      await renderUsers();

      document.getElementById('clear-btn').addEventListener('click', async () => {
        const all = await User.all();
        for (const user of all) {
          await user.destroy();
        }
        await renderUsers();
      });
    });
  </script>
</body>
</html>
```

## Defining Models

A model is a class that extends `ActiveRecord` with a `tableName` and a `columns` declaration. `columns` is the single source of truth for the model's schema — it's used to provision remote tables when syncing, document what fields the model has, and (in future versions) drive type checking.

```typescript
class Task extends ActiveRecord<Task> {
  static tableName = 'tasks';

  static columns = {
    title:    { type: 'string',  nullable: false },
    status:   { type: 'string',  default: 'pending' },
    priority: { type: 'integer', default: 0 },
    done:     { type: 'boolean', default: false }
  };
}
```

### Column options

Each entry under `columns` accepts these optional fields:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | `'string' \| 'integer' \| 'boolean' \| 'datetime'` | `'string'` | Field's data type |
| `nullable` | `boolean` | `true` | Whether `null`/`undefined` is allowed |
| `default` | `unknown` | — | Default value when not provided |
| `primaryKey` | `boolean` | `false` | Marks the field as the primary key |
| `autoIncrement` | `boolean` | `false` | Auto-incrementing integer (for primary keys) |

You don't need to declare `id` — it's added automatically as an auto-incrementing primary key.

### Schema-less mode

If you omit `static columns`, the model is schema-less — any field you put on a record is stored as-is, and (when syncing) columns are inferred from records at sync time. This is convenient for prototyping but means fresh clients can't sync the schema until at least one record exists locally, and there's no protection against typos in field names. **Declaring columns is recommended for any real app.**

## API Reference

### Database

```typescript
import { Database } from 'idb-activerecord';

const db = new Database(name: string, version?: number);
await db.connect();
db.registerModel(ModelClass);
await db.close();
```

### Model CRUD Operations

#### Create

```typescript
const user = await User.create({
  name: 'John Doe',
  email: 'john@example.com'
});
```

#### Read

```typescript
// Find by ID
const user = await User.find(1);

// Find all
const users = await User.all();

// Find first matching
const user = await User.where('name', 'John').first();

// Find with multiple conditions
const users = await User.where('age', '>=', 18)
  .where('name', '!=', 'Admin')
  .all();
```

#### Update

```typescript
// Update a specific record
await user.update({ age: 31 });

// Update multiple records
await User.where('status', 'active').update({ lastSeen: Date.now() });
```

#### Delete

```typescript
// Delete a specific record
await user.destroy();

// Delete multiple records
await User.where('age', '<', 18).destroyAll();
```

### Query Builder

```typescript
// Chaining conditions
const users = await User.where('age', '>=', 18)
  .where('name', 'like', 'John%')
  .orderBy('name', 'asc')
  .limit(10)
  .all();

// Count records
const count = await User.where('age', '>=', 18).count();

// Check existence
const exists = await User.where('email', 'john@example.com').exists();
```

### Relationships

```typescript
class Post extends ActiveRecord<Post> {
  static tableName = 'posts';
  
  // Define relationships
  static belongsTo = {
    author: User
  };
}

class User extends ActiveRecord<User> {
  static tableName = 'users';
  
  static hasMany = {
    posts: Post
  };
  
  static hasOne = {
    profile: Profile
  };
}

// Access relationships
const user = await User.find(1);
const posts = await user.hasMany('posts'); // Returns user's posts
const profile = await user.hasOne('profile'); // Returns user's profile

const post = await Post.find(1);
const author = await post.belongsTo('author'); // Returns post's author
```

### Schema management

Schema is handled automatically. Register your models before calling `connect()` and `Database` creates any missing object stores and indexes, bumping the IndexedDB version as needed:

```typescript
const db = new Database('my-app');
db.registerModel(User);
db.registerModel(Post);
await db.connect();  // creates 'users' and 'posts' stores if they don't exist
```

**Adding indexes** — define `static indexes` on your model and they are created automatically on the first `connect()`:

```typescript
class User extends ActiveRecord {
  static tableName = 'users';

  static indexes = [
    { name: 'email_index', keyPath: 'email', unique: true },
    { name: 'age_index',   keyPath: 'age' }
  ];
}
```

**Adding a new model later** — just register it and reconnect. `Database` probes the existing schema, detects the missing store, and runs an upgrade automatically:

```typescript
// v1: only User existed
const db = new Database('my-app');
db.registerModel(User);
await db.connect();

// Later — add Post without touching a version number
db.registerModel(Post);
await db.connect();  // detects missing 'posts' store, upgrades transparently
```

**Sync stores** (`__sync_meta`, `__sync_changes`) are also created automatically the first time `db.sync()` is called or a sync-enabled model is registered — no extra setup required.

> Migrations are automatic — the `Migration` class is exported for advanced use but most apps won't need it directly.

### Transactions

```typescript
// Automatic transaction in CRUD operations
await User.transaction(async () => {
  const user = await User.create({ name: 'John' });
  await Post.create({ title: 'Hello', userId: user.id });
});

// Begin a manual transaction
const tx = await User.beginTransaction();
// Use the transaction for operations (implementation dependent)
```

## Advanced Usage

### Custom Indexes

```typescript
class User extends ActiveRecord<User> {
  static tableName = 'users';
  
  static indexes = [
    { name: 'email_index', keyPath: 'email', unique: true },
    { name: 'age_index', keyPath: 'age' }
  ];
}
```

### Scopes

```typescript
class User extends ActiveRecord<User> {
  static tableName = 'users';
  
  static adults() {
    return this.where('age', '>=', 18);
  }
  
  static recent() {
    return this.orderBy('createdAt', 'desc').limit(10);
  }
}

// Use scopes
const recentAdults = await User.adults().recent().all();
```

### Callbacks

```typescript
class User extends ActiveRecord<User> {
  static tableName = 'users';
  
  static beforeCreate = (record) => {
    record.createdAt = new Date();
  };
  
  static afterUpdate = (record) => {
    console.log('User updated:', record);
  };
}
```

### Validation

```typescript
class User extends ActiveRecord<User> {
  static tableName = 'users';
  
  static validates = {
    name: { presence: true, length: { minimum: 2 } },
    email: { presence: true, format: /@/ }
  };
}

const user = Object.create(User.prototype);
Object.assign(user, { name: '' });
const valid = await user.isValid();
if (!valid) {
  console.log(user.errors);
}
```

## Sync Adapter (Experimental)

Sync local IndexedDB data with remote databases using pluggable adapters.

```typescript
import { RestAdapter, BaseAdapter, ConflictStrategy } from 'idb-activerecord';

const adapter = new RestAdapter();
await adapter.connect({
  url: 'https://api.example.com',
  authToken: 'Bearer xyz'
});

// Pull remote changes
const remoteUsers = await adapter.pull({ table: 'users', since: lastSync });

// Push local changes
const result = await adapter.push([user1, user2]);

// Resolve conflicts
const winner = await adapter.resolveConflict(localUser, remoteUser, ConflictStrategy.LAST_WRITE_WINS);
```

### Built-in Adapters

| Adapter | Description | Status |
|---------|-------------|--------|
| `RestAdapter` | Generic REST API sync | ✅ Ready |
| `TursoAdapter` | Turso (SQLite edge) | 🚧 Planned |
| `SupabaseAdapter` | Supabase (PostgreSQL) | 🚧 TBD |

Create custom adapters by extending `BaseAdapter`:

```typescript
import {
  BaseAdapter,
  AdapterConfig,
  SyncQuery,
  PushOptions,
  SyncResult,
  TableSchema,
  SyncMigration,
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
    // fetch records from your backend since query.since
    return [];
  }

  async push<T extends ActiveRecord>(records: T[], options?: PushOptions): Promise<SyncResult> {
    // send records to your backend
    return { pushed: records.length, pulled: 0, conflicts: 0, errors: [], timestamp: new Date() };
  }

  async getRemoteSchema(table: string): Promise<TableSchema> {
    // return column/index definitions for the table
    return { name: table, columns: [], indexes: [] };
  }

  async applyMigration(migration: SyncMigration): Promise<void> {
    // send migration intent to your backend (optional)
  }
}
```

## Multi-User Sync

For multi-user / multi-device scenarios, `idb-activerecord` handles change tracking, soft deletes, and version-based conflict resolution automatically.

### Basic usage

Enable sync on your model, connect an adapter, call `db.sync()`:

```typescript
import { Database, ActiveRecord, RestAdapter, ConflictStrategy } from 'idb-activerecord';

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

const adapter = new RestAdapter();
await adapter.connect({ url: 'https://api.example.com' });

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
await engine.mergeChanges('tasks', remote, adapter, { strategy: ConflictStrategy.LOCAL_WINS });

// Reset sync state for a table (forces full re-pull on next sync)
await engine.clearSyncData('tasks');
```

### How it works

- **Change tracking** — every `create`/`update`/`destroy` on a sync-enabled model appends to an internal `__sync_changes` store
- **Version stamps** — each record gets `_version` (integer) and `updatedAt` fields, incremented on every write
- **Soft deletes** — `destroy()` sets `_deletedAt` so deletions propagate as tombstones to other devices
- **Cursor tracking** — `__sync_meta` persists `lastPullAt` per table so pulls only fetch what changed since last sync
- **Conflict resolution** — newer `_version` wins; ties fall back to `updatedAt`; or use `ConflictStrategy.LOCAL_WINS` / `REMOTE_WINS` / `CUSTOM`

See [`examples/rest-sync`](./examples/rest-sync) for a runnable multi-user demo with a SQLite backend.

## Browser Support

- Chrome 24+
- Firefox 16+
- Safari 10+
- Edge 12+
- Opera 15+

## Contributing

Contributions are welcome! Feel free to open a PR or issue.

## License

ISC

## Author

Vann Ek

## See Also

- [IndexedDB API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [Ruby on Rails ActiveRecord](https://guides.rubyonrails.org/active_record_basics.html)
