# Turso Sync Example

Same browser demo as [`rest-sync`](../rest-sync/), but the data syncs to a real
remote **Turso (libSQL) database** via a tiny Node proxy that uses
`TursoAdapter` internally.

```
browser (IndexedDB) ──HTTP──> server.js ──libSQL──> Turso Cloud
                                  └─ uses TursoAdapter to talk to libSQL
```

## Setup

1. **Install deps** (already pulled in by `npm install`):

   - `@libsql/client` — connects to `libsql://...` Turso URLs

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
| `server.js` | Node HTTP proxy: REST endpoints → `@libsql/client` → Turso. Uses `TursoAdapter` for storage. |
| `app.js` | Browser app (clone of `rest-sync/app.js`, only `API_URL` and IDB DB name changed). |
| `index.html` | Browser UI (clone of `rest-sync/index.html`). |
| `.env.example` | Template for `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. |

## Architecture notes

- **Why the proxy?** `@libsql/client` works in the browser, but bundling it
  here would require a build step and shipping the auth token to clients.
  Tiny proxy = clean separation, server-held credentials, and an
  illustration of `TursoAdapter` running in a Node service.
- **Why `RestAdapter` in the browser?** The proxy speaks the same wire
  protocol as `examples/rest-sync/server.js`. The browser code is essentially
  unchanged from rest-sync — only the URL differs.
- **Why `TursoAdapter` on the server?** Dogfooding. Every storage operation
  in `server.js` (`ensureTable`, `pull`, `push`) is delegated to the same
  adapter you'd use elsewhere.

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
