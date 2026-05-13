# IDB ActiveRecord Examples

Browser-based demos of the IDB ActiveRecord library.

## Running

Start the example server:

```bash
npm run example
```

Then open your browser to: http://localhost:8080

## Available Examples

| Example | Path | Description |
|---------|------|-------------|
| **Basic CRUD** | `/examples/basic-crud/` | Full CRUD demo with users, queries, validation, and statistics |
| **REST Sync** | `/examples/rest-sync/` | Sync local IndexedDB with a mock REST API using `RestAdapter` |

## Basic CRUD

Showcases all major library features:

- Create, read, update, delete users
- Query with `where()`, `orderBy()`, `limit()`
- Validation (presence, format, length)
- Real-time statistics

## REST Sync

Demonstrates the Sync Adapter API:

- **Push**: Send local tasks to a remote REST API
- **Pull**: Fetch remote tasks into local IndexedDB
- **Conflict Resolution**: `LAST_WRITE_WINS` strategy demo
- **Mock Server**: In-memory REST API with no backend required

Open DevTools > Network to inspect HTTP requests.
