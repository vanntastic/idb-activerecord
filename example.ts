// Example usage of IDB ActiveRecord

import { Database, ActiveRecord } from './src/index';

// Define your model interface
interface User {
  id?: string;  // UUID format (e.g., 'f47ac10b-58cc-4372-a567-0e02b2c3d479')
  name: string;
  email: string;
  age: number;
}

// Create a model class
class User extends ActiveRecord<User> {
  static tableName = 'users';
  
  static indexes = [
    { name: 'email_index', keyPath: 'email', unique: true },
    { name: 'age_index', keyPath: 'age' }
  ];
  
  static validates = {
    name: { presence: true, length: { minimum: 2 } },
    email: { presence: true, format: /@/ }
  };
  
  static beforeCreate = (record: any) => {
    console.log('Before create:', record);
  };
  
  static afterCreate = (record: any) => {
    console.log('After create:', record);
  };
}

async function main() {
  // Initialize the database
  const db = new Database('my-app', 1);
  db.registerModel(User);
  await db.connect();

  try {
    // Create a record
    const user = await User.create({
      name: 'John Doe',
      email: 'john@example.com',
      age: 30
    });
    console.log('Created user:', user);

    // Find a record
    const foundUser = await User.find(user.id!);
    console.log('Found user:', foundUser);

    // Update a record
    await user.update({ age: 31 });
    console.log('Updated user:', user);

    // Query with conditions
    const adults = await User.where('age', '>=', 18).all();
    console.log('Adults:', adults);

    // Query with ordering and limit
    const recentUsers = await User.where('age', '>', 0).orderBy('age', 'desc').limit(5).all();
    console.log('Recent users:', recentUsers);

    // Count records
    const count = await User.where('age', '>=', 18).count();
    console.log('Adult count:', count);

    // Check existence
    const exists = await User.where('email', 'john@example.com').exists();
    console.log('User exists:', exists);

    // Update multiple records
    await User.where('age', '<', 18).update({ status: 'minor' });

    // Delete a record
    await user.destroy();
    console.log('User deleted');

    // Delete multiple records
    await User.where('age', '>', 100).destroyAll();

    // Use transactions
    await User.transaction(async () => {
      const user1 = await User.create({ name: 'Alice', email: 'alice@example.com', age: 25 });
      const user2 = await User.create({ name: 'Bob', email: 'bob@example.com', age: 30 });
      console.log('Transaction completed:', user1, user2);
    });

    // Validation
    const invalidUser = Object.create(User.prototype);
    Object.assign(invalidUser, { name: '', email: 'invalid' });
    const isValid = await invalidUser.isValid();
    if (!isValid) {
      console.log('Validation errors:', invalidUser.errors);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.close();
  }
}

// Run the example
main().catch(console.error);
