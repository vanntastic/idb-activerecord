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

Demonstrates the Sync Adapter API with a real Node.js REST API backed by SQLite.

- **Push**: Send local tasks to a remote REST API (upserted in SQLite)
- **Pull**: Fetch remote tasks into local IndexedDB
- **Conflict Resolution**: `LAST_WRITE_WINS` strategy demo
- **Real Persistence**: Tasks survive across browser refreshes and server restarts

`npm run example` automatically starts both the static file server and the SQLite-backed REST API. Then open `/examples/rest-sync/`. See [`rest-sync/README.md`](./rest-sync/README.md) for details.
