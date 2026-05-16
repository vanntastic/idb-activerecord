# REST Sync Example

Demonstrates syncing local IndexedDB data with a real REST API server backed by SQLite.

## Architecture

```
┌─────────────────────┐         ┌───────────────────────┐
│  Browser (port 8080)│         │  Node API (port 3001) │
│                     │  HTTP   │                       │
│  IndexedDB          │ ──────▶ │  node:sqlite          │
│  ↕ ActiveRecord     │ ◀────── │  ↕ tasks.db           │
│  ↕ RestAdapter      │         │                       │
└─────────────────────┘         └───────────────────────┘
```

## Features

- **Local CRUD**: Create, toggle, and delete tasks in IndexedDB
- **Push Sync**: Send all local tasks to the remote REST API (upserts in SQLite)
- **Pull Sync**: Fetch remote tasks and merge into local IndexedDB
- **Conflict Resolution**: Demo of `LAST_WRITE_WINS` strategy
- **Real Persistence**: SQLite database (`sync-demo.db`) survives restarts

## Running

```bash
npm run example
```

This runs both the static file server (port 8080) and the SQLite-backed REST API (port 3001). Requires Node 22.5+ for `node:sqlite`.

Then open: http://localhost:8080/examples/rest-sync/

To run them individually:

```bash
npm run example:static     # browser app only
npm run example:sync-api   # REST API only
```

## Endpoints

The API server (`localhost:3001`) exposes:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Health check |
| GET | `/schema/tasks` | Fetch table schema |
| GET | `/tasks?since=&limit=&offset=` | Pull tasks (with filters) |
| POST | `/tasks` | Push tasks (upsert by id) |
| DELETE | `/tasks/:id` | Delete a single task |
| DELETE | `/tasks` | Clear all tasks |
| POST | `/migrations` | Record a migration |

## What to Observe

1. Open **DevTools > Network** to inspect HTTP requests
2. Add tasks locally — they live in IndexedDB only
3. Click **Push to Remote** — `POST /tasks` upserts into SQLite
4. Clear IndexedDB (DevTools > Application > IndexedDB > sync-demo) and reload
5. Click **Pull from Remote** — `GET /tasks` restores from SQLite
6. Stop and restart the API server — data persists in `sync-demo.db`
7. Click **Demo Conflict Resolution** to see `BaseAdapter.resolveConflict()` in action

## Database File

The SQLite database is created at `examples/rest-sync/sync-demo.db`. Delete it to reset state.
