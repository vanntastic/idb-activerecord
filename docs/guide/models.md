# Models

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

You don't need to declare `id` — it's added automatically as a UUID primary key. When creating records, a UUID is generated automatically if you don't provide one.

### Schema-less mode

If you omit `static columns`, the model is schema-less — any field you put on a record is stored as-is, and (when syncing) columns are inferred from records at sync time. This is convenient for prototyping but means fresh clients can't sync the schema until at least one record exists locally, and there's no protection against typos in field names. **Declaring columns is recommended for any real app.**

### Declaring relationships

Models can declare `hasOne`, `hasMany`, and `belongsTo` associations. Use string references (the related model's `tableName`) to avoid circular import issues:

```typescript
class Board extends ActiveRecord<Board> {
  static tableName = 'boards';
  static hasMany = { columns: 'columns' };
}

class Column extends ActiveRecord<Column> {
  static tableName = 'columns';
  static belongsTo = { board: 'boards' };
  static hasMany = { cards: 'cards' };
}

class Card extends ActiveRecord<Card> {
  static tableName = 'cards';
  static belongsTo = { column: 'columns' };
}
```

Relationship references are resolved at query time against `Database`'s internal model registry. If a string references an unknown table, `Database.connect()` throws with a clear error. Class references continue to work as before.

Foreign keys follow these conventions:

- `belongsTo` uses the relationship name: a `Column` with `belongsTo = { board: 'boards' }` should have a `boardId` field.
- `hasOne` / `hasMany` use the declaring model's `tableName`: a `Board` with `tableName = 'boards'` and `hasMany = { columns: 'columns' }` looks for `Column` records whose `boardsId` matches the board's `id`.


### Accessing relationships

```typescript
class Post extends ActiveRecord<Post> {
  static tableName = 'posts';
  
  // Define relationships
  static belongsTo = {
    author: 'users'
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

// Access relationships via property syntax (recommended)
const user = await User.find(userId);
const posts = await user.posts;        // hasMany
const profile = await user.profile;   // hasOne

const post = await Post.find(postId);
const author = await post.author;     // belongsTo
```

Property accessors are defined automatically on every instance returned by `find`, `all`, `create`, etc. Each property is a lazy getter that returns the same Promise as the corresponding method call.

> **Legacy method syntax** — the explicit method calls below are still supported but considered legacy. Prefer the property accessor syntax above.
>
> ```typescript
> const posts   = await user.hasMany('posts');
> const profile = await user.hasOne('profile');
> const author  = await post.belongsTo('author');
> ```
