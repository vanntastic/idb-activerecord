# Usage Guide

This guide provides detailed examples of how to use IDB ActiveRecord in your projects.

## Installation

```bash
npm install idb-activerecord
```

## Basic Setup

```typescript
import { Database, ActiveRecord } from 'idb-activerecord';

// Define your model interface
interface User {
  id?: string;  // UUID format (e.g., 'f47ac10b-58cc-4372-a567-0e02b2c3d479')
  name: string;
  email: string;
}

// Create a model class
class User extends ActiveRecord<User> {
  static tableName = 'users';
}

// Initialize the database
const db = new Database('my-app', 1);
db.registerModel(User);
await db.connect();
```

## Creating Records

```typescript
// Create a single record
const user = await User.create({
  name: 'John Doe',
  email: 'john@example.com'
});
console.log(user.id); // Auto-generated UUID, e.g. 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
```

## Reading Records

```typescript
// Find by ID (UUID string)
const user = await User.find('f47ac10b-58cc-4372-a567-0e02b2c3d479');

// Find all records
const users = await User.all();

// Find with conditions
const adults = await User.where('age', '>=', 18).all();

// Find first matching record
const user = await User.where('name', 'John').first();

// Chain multiple conditions
const users = await User.where('age', '>=', 18)
  .where('name', '!=', 'Admin')
  .orderBy('name', 'asc')
  .limit(10)
  .all();
```

## Updating Records

```typescript
// Update a specific record
await user.update({ age: 31 });

// Update multiple records
await User.where('status', 'active').update({ lastSeen: Date.now() });
```

## Deleting Records

```typescript
// Delete a specific record
await user.destroy();

// Delete multiple records
await User.where('age', '<', 18).destroyAll();
```

## Query Builder Methods

The QueryBuilder supports chaining:

- `where(field, operator, value)` - Add a condition
- `orderBy(field, direction)` - Sort results ('asc' or 'desc')
- `limit(count)` - Limit number of results
- `all()` - Get all matching records
- `first()` - Get first matching record
- `count()` - Count matching records
- `exists()` - Check if any records match
- `update(data)` - Update all matching records
- `destroyAll()` - Delete all matching records

## Operators

Supported operators in `where()`:

- `=` - Equal
- `!=` - Not equal
- `>` - Greater than
- `>=` - Greater than or equal
- `<` - Less than
- `<=` - Less than or equal
- `like` - Pattern matching (use `%` as wildcard)

## Transactions

```typescript
// Automatic transaction
await User.transaction(async () => {
  const user = await User.create({ name: 'John' });
  await Post.create({ title: 'Hello', userId: user.id });
});
```

## Callbacks

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

Available callbacks:
- `beforeCreate`
- `afterCreate`
- `beforeUpdate`
- `afterUpdate`
- `beforeDestroy`
- `afterDestroy`

## Validation

```typescript
class User extends ActiveRecord<User> {
  static tableName = 'users';
  
  static validates = {
    name: { presence: true, length: { minimum: 2 } },
    email: { presence: true, format: /@/ },
    age: { presence: true }
  };
}

// Validate before saving
const user = Object.create(User.prototype);
Object.assign(user, { name: '', email: 'invalid' });
const valid = await user.isValid();
if (!valid) {
  console.log(user.errors);
}
```

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

## Closing the Database

```typescript
await db.close();
```

## TypeScript Support

The library is fully typed. Define your model interface for type safety:

```typescript
interface Post {
  id?: string;  // UUID format
  title: string;
  content: string;
  published: boolean;
}

class Post extends ActiveRecord<Post> {
  static tableName = 'posts';
}

// Now you get autocomplete and type checking
const post = await Post.create({
  title: 'Hello World',
  content: 'My first post',
  published: true
});
```
