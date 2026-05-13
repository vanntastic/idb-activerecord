# REST Sync Example

Demonstrates syncing local IndexedDB data with a remote REST API using the `RestAdapter`.

## Features

- **Local CRUD**: Create, toggle, and delete tasks in IndexedDB
- **Push Sync**: Send all local tasks to the remote REST API
- **Pull Sync**: Fetch remote tasks and merge into local IndexedDB
- **Conflict Resolution**: Demo of `LAST_WRITE_WINS` strategy
- **Mock Server**: In-memory REST API runs entirely in the browser (no backend needed)

## Running

```bash
npm run example
```

Then open: http://localhost:8080/examples/rest-sync/

## What to Observe

1. Open **DevTools > Network** to inspect the HTTP requests
2. Add tasks locally, then **Push to Remote** — see POST `/tasks`
3. Clear your IndexedDB (DevTools > Application > IndexedDB > sync-demo), then **Pull from Remote** — see GET `/tasks`
4. Click **Demo Conflict Resolution** to see `BaseAdapter.resolveConflict()` in action
