# Querying

## Database

```typescript
import { Database } from 'idb-activerecord';

const db = new Database('my-app');
db.registerModel(User);
await db.connect();
await db.close();
```

## Model CRUD Operations

### Create

```typescript
const user = await User.create({
  name: 'John Doe',
  email: 'john@example.com'
});
```

### Read

```typescript
// Find by ID (UUID string)
const user = await User.find('f47ac10b-58cc-4372-a567-0e02b2c3d479');

// Find all
const users = await User.all();

// Find first matching
const user = await User.where('name', 'John').first();

// Find with multiple conditions
const users = await User.where('age', '>=', 18)
  .where('name', '!=', 'Admin')
  .all();
```

### Update

```typescript
// Update a specific record
await user.update({ age: 31 });

// Update multiple records
await User.where('status', 'active').update({ lastSeen: Date.now() });
```

### Delete

```typescript
// Delete a specific record
await user.destroy();

// Delete multiple records
await User.where('age', '<', 18).destroyAll();
```

## Query Builder

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


## Scopes

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
const recentAdults = await User.adults().orderBy('createdAt', 'desc').limit(10).all();
const recentUsers = await User.recent().all();
```
