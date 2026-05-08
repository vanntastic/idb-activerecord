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
- **Migrations**: Simple schema versioning and migration system
- **Transactions**: Automatic transaction management with manual control when needed
- **Lightweight**: Zero dependencies, small bundle size
- **Browser Support**: Works in all modern browsers with IndexedDB support

## Installation

```bash
npm install idb-activerecord
# or
yarn add idb-activerecord
# or
pnpm add idb-activerecord
```

## Quick Start

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
}

// Access relationships
const user = await User.find(1);
const posts = await user.posts(); // Returns user's posts

const post = await Post.find(1);
const author = await post.author(); // Returns post's author
```

### Migrations

```typescript
import { Migration } from 'idb-activerecord';

class CreateUsersTable extends Migration {
  up() {
    this.createTable('users', (table) => {
      table.autoIncrement('id').primaryKey();
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

// Run migrations
await db.migrateUp();
```

### Transactions

```typescript
// Automatic transaction in CRUD operations
await User.transaction(async () => {
  const user = await User.create({ name: 'John' });
  await Post.create({ title: 'Hello', userId: user.id });
});

// Manual transaction control
const tx = await User.beginTransaction();
try {
  await User.create({ name: 'John' }, tx);
  await Post.create({ title: 'Hello' }, tx);
  await tx.commit();
} catch (error) {
  await tx.rollback();
  throw error;
}
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

const user = new User({ name: '' });
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

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## License

ISC

## Author

Vann Ek

## See Also

- [IndexedDB API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [Ruby on Rails ActiveRecord](https://guides.rubyonrails.org/active_record_basics.html)
