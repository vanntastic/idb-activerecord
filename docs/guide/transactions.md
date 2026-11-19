# Transactions

`create()` opens its own transaction. Calling `User.transaction()` does not make the following model CRUD calls share that transaction, so if creating the post fails, the user remains persisted. For atomic writes across stores, use native IndexedDB requests within a single multi-store transaction.

```typescript
// Independent writes, not an atomic transaction
const user = await User.create({ name: 'John' });
await Post.create({ title: 'Hello', userId: user.id });

// Begin a manual transaction
const tx = await User.beginTransaction();
// Use the transaction for operations (implementation dependent)
```
