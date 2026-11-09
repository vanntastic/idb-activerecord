# Callbacks

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
