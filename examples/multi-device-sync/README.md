# Multi-Device Sync Example

A **self-contained, backend-free** simulation of the classic reconciliation
scenario: a phone holding thousands of records, and a laptop that only has a
few local records, both syncing through a shared cloud.

Everything runs in the browser:

- **Phone** → IndexedDB database `md-phone`
- **Laptop** → IndexedDB database `md-laptop`
- **Cloud** → an in-memory `CloudAdapter` that implements the same
  `SyncAdapter` contract as `TursoAdapter` and `SQLiteAdapter`

## Running

From the repo root:

```bash
npm run build      # ensure dist/ is up to date (the page imports ../../dist/index.js)
npm run example    # static server on http://localhost:8080
```

Then open <http://localhost:8080/examples/multi-device-sync/>.

## What to try

1. **Seed phone** — pick a record count (up to 2,000) and create them on the phone.
2. **Sync phone ⇄ cloud** — the phone pushes all its pending tasks to the cloud.
3. **Sync laptop ⇄ cloud** — the laptop pushes its 2 local tasks *and* pulls
   down everything the phone uploaded. Watch the counts converge.

Extra buttons demonstrate conflict and tombstone handling:

- **Edit a task** (phone or laptop) bumps `_version` and `updatedAt`.
- **Delete a task** (phone) writes a soft-delete tombstone that propagates on sync.
- **Add local task** (laptop) creates a laptop-only record that gets pushed up.

## How reconciliation works

The `SyncEngine` runs **push → pull → merge** on every `sync()` call:

1. **Push** only the records tracked in the local `__sync_changes` log — so the
   laptop pushes *its* edits, not the thousands it has not seen yet.
2. **Pull** records changed since `lastPullAt`. On a device's first sync this is
   `null`, so it pulls everything (the phone's full dataset hydrates the laptop).
   Later syncs are incremental.
3. **Merge** each record:
   - no local copy → insert the remote record,
   - higher `_version` wins,
   - equal version → newer `updatedAt` wins (last-write-wins),
   - tombstones (`_deletedAt`) propagate deletions across devices.

Because push happens before pull, a device's own edits are written to the cloud
first and then pulled back as harmless no-ops — so local changes survive while
remote data still flows in.

## Notes

- IDs are string UUIDs (`crypto.randomUUID()`), stored as `TEXT PRIMARY KEY` by
  the SQL adapters.
- The demo resets both IndexedDB databases on load and via the **Reset demo**
  button, so it is always reproducible.
