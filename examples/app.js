// Import the library from the built dist folder
// Run `npm run build` first to compile the TypeScript
import { Database, ActiveRecord } from '../dist/index.js';

// Define User model
class User extends ActiveRecord {
  static tableName = 'users';
  
  static indexes = [
    { name: 'email_index', keyPath: 'email', unique: true },
    { name: 'age_index', keyPath: 'age' }
  ];
  
  static validates = {
    name: { presence: true, length: { minimum: 2 } },
    email: { presence: true, format: /@/ },
    age: { presence: true }
  };
}

// Initialize database
const db = new Database('idb-activerecord-demo', 1);
db.registerModel(User);

// Wait for DOM to be ready
let dbConnected = false;

async function initDatabase() {
  try {
    await db.connect();
    dbConnected = true;
    console.log('Database connected successfully');
    updateStats();
    loadAllUsers();
  } catch (error) {
    console.error('Failed to connect to database:', error);
    alert('Failed to connect to database. Please check console for details.');
  }
}

// Helper function to display output
function displayOutput(elementId, data) {
  const output = document.getElementById(elementId);
  output.innerHTML = `<pre>${JSON.stringify(data, null, 2)}</pre>`;
}

// Helper function to update stats
async function updateStats() {
  if (!dbConnected) return;
  
  try {
    const allUsers = await User.all();
    const adults = await User.where('age', '>=', 18).all();
    
    document.getElementById('totalUsers').textContent = allUsers.length;
    document.getElementById('adultUsers').textContent = adults.length;
    document.getElementById('recentUsers').textContent = allUsers.length; // Simplified for demo
  } catch (error) {
    console.error('Error updating stats:', error);
  }
}

// Create user
window.createUser = async function() {
  if (!dbConnected) {
    alert('Database not connected yet. Please wait...');
    return;
  }

  const name = document.getElementById('userName').value;
  const email = document.getElementById('userEmail').value;
  const age = parseInt(document.getElementById('userAge').value);

  if (!name || !email || !age) {
    alert('Please fill in all fields');
    return;
  }

  try {
    const user = await User.create({ name, email, age });
    console.log('User created:', user);
    alert(`User created with ID: ${user.id}`);
    
    // Clear form
    document.getElementById('userName').value = '';
    document.getElementById('userEmail').value = '';
    document.getElementById('userAge').value = '';
    
    updateStats();
    loadAllUsers();
  } catch (error) {
    console.error('Error creating user:', error);
    alert('Error creating user: ' + error.message);
  }
};

// Find user
window.findUser = async function() {
  if (!dbConnected) {
    alert('Database not connected yet. Please wait...');
    return;
  }

  const id = parseInt(document.getElementById('findUserId').value);
  if (!id) {
    alert('Please enter a user ID');
    return;
  }

  try {
    const user = await User.find(id);
    displayOutput('findOutput', user || 'User not found');
  } catch (error) {
    console.error('Error finding user:', error);
    displayOutput('findOutput', { error: error.message });
  }
};

// Query users
window.queryUsers = async function() {
  if (!dbConnected) {
    alert('Database not connected yet. Please wait...');
    return;
  }

  const minAge = parseInt(document.getElementById('queryAge').value);
  
  try {
    let query = User;
    if (minAge) {
      query = User.where('age', '>=', minAge);
    }
    const users = await query.all();
    displayOutput('queryOutput', users);
  } catch (error) {
    console.error('Error querying users:', error);
    displayOutput('queryOutput', { error: error.message });
  }
};

// Load all users
window.loadAllUsers = async function() {
  if (!dbConnected) {
    return;
  }

  try {
    const users = await User.all();
    const userList = document.getElementById('userList');
    userList.innerHTML = '';
    
    users.forEach(user => {
      const li = document.createElement('li');
      li.className = 'user-item';
      li.innerHTML = `
        <div>
          <strong>${user.name}</strong> (${user.email}) - Age: ${user.age}
        </div>
        <button onclick="deleteUserById(${user.id})">Delete</button>
      `;
      userList.appendChild(li);
    });
  } catch (error) {
    console.error('Error loading users:', error);
  }
};

// Update user
window.updateUser = async function() {
  if (!dbConnected) {
    alert('Database not connected yet. Please wait...');
    return;
  }

  const id = parseInt(document.getElementById('updateUserId').value);
  const age = parseInt(document.getElementById('updateAge').value);

  if (!id || !age) {
    alert('Please enter user ID and new age');
    return;
  }

  try {
    const user = await User.find(id);
    if (!user) {
      alert('User not found');
      return;
    }

    await user.update({ age });
    alert(`User ${id} updated to age ${age}`);
    updateStats();
    loadAllUsers();
  } catch (error) {
    console.error('Error updating user:', error);
    alert('Error updating user: ' + error.message);
  }
};

// Delete user
window.deleteUser = async function() {
  if (!dbConnected) {
    alert('Database not connected yet. Please wait...');
    return;
  }

  const id = parseInt(document.getElementById('deleteUserId').value);
  if (!id) {
    alert('Please enter a user ID');
    return;
  }

  deleteUserById(id);
};

// Delete user by ID (helper for the list)
window.deleteUserById = async function(id) {
  if (!confirm(`Are you sure you want to delete user ${id}?`)) {
    return;
  }

  try {
    const user = await User.find(id);
    if (!user) {
      alert('User not found');
      return;
    }

    await user.destroy();
    alert(`User ${id} deleted`);
    updateStats();
    loadAllUsers();
  } catch (error) {
    console.error('Error deleting user:', error);
    alert('Error deleting user: ' + error.message);
  }
};

// Initialize on load
initDatabase();
