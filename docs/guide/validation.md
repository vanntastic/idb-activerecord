# Validation

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
