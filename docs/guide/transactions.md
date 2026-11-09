# Transactions

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
