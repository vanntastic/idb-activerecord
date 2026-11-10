# Getting Started

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
<script src="https://cdn.jsdelivr.net/npm/idb-activerecord@2/dist/idb-activerecord.min.js"></script>
```

All exports are available under the global `IDBActiveRecord` object:

```html
<script>
  const { Database, ActiveRecord } = IDBActiveRecord;
</script>
```

## Migration from v1.x to v2.x

**Breaking Change:** IDs have changed from `number` (auto-incrementing) to `string` (UUID format).

| Before (v1.x) | After (v2.x) |
|---------------|--------------|
| `id?: number` | `id?: string` |
| `await User.find(1)` | `await User.find('uuid-string')` |
| Auto-generated sequential integers | Auto-generated UUIDs (e.g., `'f47ac10b-58cc-4372-a567-0e02b2c3d479'`) |

**What you need to change:**
- Update TypeScript interfaces: change `id?: number` to `id?: string`
- Update any code that performs arithmetic on IDs
- Update any external sync servers that expected numeric IDs

**Benefits:**
- Better multi-user sync (no ID collisions)
- Offline-first support (generate IDs without server)
- Distributed systems friendly

## Quick Start

### With npm (TypeScript / ESM)

```typescript
import { ActiveRecord, Database } from 'idb-activerecord';

// Define your model
interface User {
  id?: string;  // UUID format (e.g., 'f47ac10b-58cc-4372-a567-0e02b2c3d479')
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

// Find a record by UUID
const foundUser = await User.find(user.id);

// Update a record
await user.update({ age: 31 });

// Delete a record
await user.destroy();

// Query with conditions
const adults = await User.where('age', '>=', 18).all();
```

### With CDN (plain HTML)

```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.jsdelivr.net/npm/idb-activerecord@2/dist/idb-activerecord.min.js"></script>
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

