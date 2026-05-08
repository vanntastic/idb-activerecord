# IDB ActiveRecord Browser Demo

This folder contains a browser-based demo of the IDB ActiveRecord library.

## Running the Demo

Start the example server:

```bash
npm run example
```

Then open your browser to: http://localhost:8080

## Features Demonstrated

The demo showcases all major features of the library:

- **Create Users**: Add new users with name, email, and age
- **Find Users**: Look up users by ID
- **Query Users**: Filter users by age or other criteria
- **List All Users**: View all users in the database
- **Update Users**: Modify user information
- **Delete Users**: Remove users from the database
- **Validation**: Demonstrates validation rules (presence, format, length)
- **Statistics**: Real-time stats showing total users, adults, etc.

## Technical Details

- The demo imports the library directly from source (`../src/index.js`)
- Uses a simple Node.js HTTP server to serve static files
- All data is stored in IndexedDB in the browser
- No backend required - everything runs client-side

## Customization

You can modify `app.js` to experiment with different features:

- Try relationships (hasOne, hasMany, belongsTo)
- Test callbacks (beforeCreate, afterUpdate, etc.)
- Experiment with query chaining
- Add validation rules
