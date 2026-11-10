# Migrations and Schema

## Schema management

Register your models before calling `connect()` and `Database` creates any missing object stores and their declared indexes, bumping the IndexedDB version as needed. Indexes are only created when their object store is first created; adding or changing `static indexes` does not update existing stores automatically:

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
await db.close();
db.registerModel(Post);
await db.connect();  // detects missing 'posts' store and upgrades
```

**Sync stores** (`__sync_meta`, `__sync_changes`) are also created automatically the first time `db.sync()` is called or a sync-enabled model is registered — no extra setup required.

> Migrations are automatic — the `Migration` class is exported for advanced use but most apps won't need it directly.


## Custom Indexes

```typescript
class User extends ActiveRecord<User> {
  static tableName = 'users';
  
  static indexes = [
    { name: 'email_index', keyPath: 'email', unique: true },
    { name: 'age_index', keyPath: 'age' }
  ];
}
```
