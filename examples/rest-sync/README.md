# REST Sync Example — Multi-User Demo

Demonstrates **multi-user bidirectional sync** between IndexedDB and a real SQLite-backed REST API using `SyncEngine`, `RestAdapter`, soft deletes, and version-based conflict resolution.

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

## Multi-User Testing

### Scenario 1: Two devices, same user

1. Open the demo in **two browser windows** (regular + incognito to use separate IndexedDB stores)
2. Keep both as user **Alice**
3. In window A: add "Buy groceries", click **🔄 Full Sync**
4. In window B: click **🔄 Full Sync** — task appears
5. In window B: toggle "Buy groceries" to done, click **🔄 Full Sync**
6. In window A: click **🔄 Full Sync** — sees the toggle from B
7. In window A: delete the task (soft delete), click **🔄 Full Sync**
8. In window B: click **🔄 Full Sync** — task moves to "Deleted" section

### Scenario 2: Two users

1. In window A: switch to **Alice**, add "Alice's task", **🔄 Full Sync**
2. In window B: switch to **Bob**, add "Bob's task", **🔄 Full Sync**
3. Each user only sees their own data (server filters by `owner_id`)
4. Switch users within a window to confirm dataset isolation

### Scenario 3: Conflict resolution

1. In window A and B (same user): edit the same task differently **without syncing**
2. In window A: **🔄 Full Sync** first (your version becomes `v2`)
3. In window B: **🔄 Full Sync** — engine detects the version conflict and applies `LAST_WRITE_WINS`

### Scenario 4: Offline-first

1. Stop the API server (Ctrl+C in the terminal running `example:sync-api`)
2. Add and edit tasks locally — they queue up in `__sync_changes` (see **Pending** counter)
3. Restart the API server
4. Click **🔄 Full Sync** — all queued changes push at once

## What's Happening Under the Hood

| Action | Local | Remote |
|--------|-------|--------|
| `Task.create()` | inserts row + logs change in `__sync_changes` | nothing |
| `task.update()` | bumps `_version`, updates `updatedAt`, logs change | nothing |
| `task.destroy()` | sets `_deletedAt` (soft delete), logs change | nothing |
| `SyncEngine.sync()` | pushes pending changes, pulls `since=lastPullAt`, merges with version compare | upserts records, applies tombstones |

Open **DevTools > Application > IndexedDB > sync-demo** to inspect the `tasks`, `__sync_changes`, and `__sync_meta` stores live.

## Database File

The SQLite database is at `examples/rest-sync/sync-demo.db`. Delete it to reset server state. The browser's IndexedDB can be cleared via DevTools or the in-app **Clear Local** button.
