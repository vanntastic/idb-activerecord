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

// Create a model class
class User extends ActiveRecord<User> {
  static tableName = 'users';
}

// Initialize the database
const db = new Database('my-app', 1);
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
    }

    const db = new Database('my-app', 1);
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

## API Reference

### Database

```typescript
import { Database } from 'idb-activerecord';

const db = new Database(name: string, version: number);
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

### Migrations

```typescript
import { Migration } from 'idb-activerecord';

class CreateUsersTable extends Migration {
  up() {
    this.createTable('users', (table) => {
      table.string('name');
      table.string('email').unique();
      table.integer('age');
      table.timestamps();
    });
  }

  down() {
    this.dropTable('users');
  }
}

// Note: Migration runner is a placeholder for future implementation
// Currently, object stores are created automatically during database connection
```

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
