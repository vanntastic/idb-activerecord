# Turso Sync Example

Same browser demo as [`rest-sync`](../rest-sync/), but the data syncs to a real
remote **Turso (libSQL) database** via a tiny Node proxy that uses
`TursoAdapter` internally.

```
browser (IndexedDB) ──HTTP──> server.js ──libSQL──> Turso Cloud
     └─ TursoAdapter (HTTP mode)  └─ TursoAdapter (direct client mode)
```

## Setup

1. **Install deps** (already pulled in by `npm install`):

   - `@libsql/client` — connects to `libsql://...` Turso URLs (bundled with idb-activerecord)

2. **Add credentials.** Copy the example env file and fill in your Turso URL +
   auth token:

   ```bash
   cp examples/turso-sync/.env.example examples/turso-sync/.env
   # edit examples/turso-sync/.env
   ```

   Get a token from <https://turso.tech> (or via the Turso CLI).

3. **Build the library** (the demo imports from `dist/`):

   ```bash
   npm run build
   ```

## Run the browser demo

```bash
npm run example:turso
```

This starts both the static file server (port 8080) and the Turso proxy server
(port 3002) in parallel. Open <http://localhost:8080/examples/turso-sync/> and
play with the demo: add tasks/notes/labels, switch between Alice and Bob, watch
them propagate to and from your Turso database in real time.


## Files

| File | Purpose |
|------|---------|
| `server.js` | Node server using `SyncServer` with `TursoAdapter` — adapter-agnostic, ready-to-use HTTP API. |
| `app.js` | Browser app (clone of `rest-sync/app.js`, only `API_URL` and IDB DB name changed). |
| `index.html` | Browser UI (clone of `rest-sync/index.html`). |
| `.env.example` | Template for `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. |

## Architecture notes

- **Unified API:** Both client and server use `TursoAdapter`. The client uses HTTP
  mode (`url`/`endpointPattern`) to talk to the proxy, while the server uses
  direct client mode with a raw `@libsql/client` instance. Same adapter, different
  transport.
- **SyncServer:** The server uses the `SyncServer` module — a ready-to-use
  HTTP server that's adapter-agnostic. You can import `SyncServer` in your own
  projects to avoid writing custom server logic.
- **Why the proxy?** `@libsql/client` works in the browser, but bundling it
  here would require a build step and shipping the auth token to clients.
  Tiny proxy = clean separation, server-held credentials.
- **Dogfooding:** Every storage operation in `server.js` (`ensureTable`, `pull`, `push`)
  is delegated to the same `TursoAdapter` you'd use elsewhere. The server passes
  a raw `@libsql/client` instance directly — no shimming needed.

## API endpoints (mirrors rest-sync)

| Method | Path | Backed by |
|--------|------|-----------|
| `GET` | `/health` | inline |
| `POST` | `/schema` | `adapter.ensureTable(table, columns)` |
| `GET` | `/schema/:table` | `adapter.getRemoteSchema(table)` |
| `GET` | `/:table` | `adapter.pull({ table, since, where: { owner_id }, includeDeleted })` |
| `POST` | `/:table` | `adapter.push(records, { table })` |
| `DELETE` | `/:table/:id` | direct `UPDATE` (soft delete) |
| `POST` | `/migrations` | no-op (schema is provisioned via `ensureTable`) |
