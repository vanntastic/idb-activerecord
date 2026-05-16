// SyncEngine - Multi-user sync orchestration
// Handles bidirectional sync with conflict resolution, change tracking,
// and soft-delete propagation across devices.

import {
  SyncAdapter,
  SyncQuery,
  SyncResult,
  ConflictStrategy
} from './sync-adapter.js';

export interface SyncMeta {
  table: string;
  lastPushAt: string | null;
  lastPullAt: string | null;
  lastSyncCursor: string | null;
}

export interface SyncChange {
  id?: number;
  table: string;
  recordId: number;
  action: 'create' | 'update' | 'delete';
  data: any;
  timestamp: string;
  synced: boolean;
}

export interface SyncOptions {
  strategy?: ConflictStrategy;
  batchSize?: number;
  onProgress?: (message: string) => void;
}

export class SyncEngine {
  private db: IDBDatabase | null = null;

  setDatabase(db: IDBDatabase): void {
    this.db = db;
  }

  // ------------------------------------------------------------------
  // Sync Meta helpers
  // ------------------------------------------------------------------

  private async getSyncMeta(table: string): Promise<SyncMeta> {
    if (!this.db) throw new Error('Database not connected');
    if (!this.db.objectStoreNames.contains('__sync_meta')) {
      throw new Error('__sync_meta store missing. Bump database version to recreate stores.');
    }

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(['__sync_meta'], 'readonly');
      const store = tx.objectStore('__sync_meta');
      const req = store.get(table);

      req.onsuccess = () => {
        resolve(req.result || {
          table,
          lastPushAt: null,
          lastPullAt: null,
          lastSyncCursor: null
        });
      };
      req.onerror = () => reject(req.error);
    });
  }

  private async setSyncMeta(table: string, updates: Partial<SyncMeta>): Promise<void> {
    if (!this.db) throw new Error('Database not connected');

    const existing = await this.getSyncMeta(table);
    const merged = { ...existing, ...updates, table };

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(['__sync_meta'], 'readwrite');
      const store = tx.objectStore('__sync_meta');
      const req = store.put(merged);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // ------------------------------------------------------------------
  // Change log helpers
  // ------------------------------------------------------------------

  private async getPendingChanges(table: string): Promise<SyncChange[]> {
    if (!this.db) throw new Error('Database not connected');
    if (!this.db.objectStoreNames.contains('__sync_changes')) return [];

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(['__sync_changes'], 'readonly');
      const store = tx.objectStore('__sync_changes');
      const index = store.index('table');
      const req = index.getAll(table);

      req.onsuccess = () => {
        const all = (req.result as SyncChange[]).filter(c => !c.synced);
        resolve(all);
      };
      req.onerror = () => reject(req.error);
    });
  }

  private async getAllChanges(table: string): Promise<SyncChange[]> {
    if (!this.db) throw new Error('Database not connected');
    if (!this.db.objectStoreNames.contains('__sync_changes')) return [];

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(['__sync_changes'], 'readonly');
      const store = tx.objectStore('__sync_changes');
      const index = store.index('table');
      const req = index.getAll(table);
      req.onsuccess = () => resolve(req.result as SyncChange[]);
      req.onerror = () => reject(req.error);
    });
  }

  private async markChangesSynced(ids: number[]): Promise<void> {
    if (!this.db || ids.length === 0) return;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(['__sync_changes'], 'readwrite');
      const store = tx.objectStore('__sync_changes');

      let completed = 0;
      ids.forEach(id => {
        const getReq = store.get(id);
        getReq.onsuccess = () => {
          if (getReq.result) {
            const putReq = store.put({ ...getReq.result, synced: true });
            putReq.onsuccess = () => {
              completed++;
              if (completed === ids.length) resolve();
            };
            putReq.onerror = () => reject(putReq.error);
          } else {
            completed++;
            if (completed === ids.length) resolve();
          }
        };
        getReq.onerror = () => reject(getReq.error);
      });
    });
  }

  private async pruneSyncedChanges(table: string): Promise<void> {
    if (!this.db) return;
    if (!this.db.objectStoreNames.contains('__sync_changes')) return;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(['__sync_changes'], 'readwrite');
      const store = tx.objectStore('__sync_changes');
      const index = store.index('table');
      const req = index.openCursor();

      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }
        const change = cursor.value as SyncChange;
        if (change.table === table && change.synced) {
          cursor.delete();
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  // ------------------------------------------------------------------
  // Core sync orchestration
  // ------------------------------------------------------------------

  async sync(table: string, adapter: SyncAdapter, options: SyncOptions = {}): Promise<SyncResult> {
    const strategy = options.strategy || ConflictStrategy.LAST_WRITE_WINS;
    const onProgress = options.onProgress || (() => {});

    const result: SyncResult = {
      pushed: 0,
      pulled: 0,
      conflicts: 0,
      errors: [],
      timestamp: new Date()
    };

    if (!adapter.isConnected()) {
      result.errors.push({ record: null, error: 'Adapter not connected' });
      return result;
    }

    // 1. Push local pending changes first (client-wins on push)
    onProgress('Pushing local changes...');
    const pushResult = await this.pushChanges(table, adapter);
    result.pushed = pushResult.pushed;
    result.errors.push(...pushResult.errors);

    // 2. Pull remote changes
    onProgress('Pulling remote changes...');
    const remoteRecords = await this.pullChanges(table, adapter);
    result.pulled = remoteRecords.length;

    // 3. Merge remote into local with conflict resolution
    onProgress('Merging changes...');
    const mergeResult = await this.mergeChanges(table, remoteRecords, adapter, strategy);
    result.conflicts = mergeResult.conflicts;
    result.errors.push(...mergeResult.errors);

    // 4. Update sync metadata
    await this.setSyncMeta(table, {
      lastPushAt: new Date().toISOString(),
      lastPullAt: new Date().toISOString()
    });

    onProgress('Sync complete.');
    return result;
  }

  // ------------------------------------------------------------------
  // Push: send local pending changes to remote
  // ------------------------------------------------------------------

  async pushChanges(table: string, adapter: SyncAdapter): Promise<SyncResult> {
    const result: SyncResult = {
      pushed: 0,
      pulled: 0,
      conflicts: 0,
      errors: [],
      timestamp: new Date()
    };

    const pending = await this.getPendingChanges(table);
    if (pending.length === 0) return result;

    // Build payload from latest change per recordId (only the most recent action matters)
    const latestById = new Map<number, SyncChange>();
    for (const change of pending) {
      latestById.set(change.recordId, change);
    }

    const payload = Array.from(latestById.values()).map(c => c.data);
    const pushResult = await adapter.push(payload, { table });

    result.pushed = pushResult.pushed;
    result.errors = pushResult.errors;

    // Mark all pending changes as synced
    const syncedIds = pending.map(c => c.id!).filter(Boolean);
    await this.markChangesSynced(syncedIds);
    await this.pruneSyncedChanges(table);

    return result;
  }

  // ------------------------------------------------------------------
  // Pull: fetch remote changes since last sync
  // ------------------------------------------------------------------

  async pullChanges(table: string, adapter: SyncAdapter): Promise<any[]> {
    const meta = await this.getSyncMeta(table);

    const query: SyncQuery = {
      table,
      since: meta.lastPullAt ? new Date(meta.lastPullAt) : undefined,
      limit: 1000
    };

    return adapter.pull(query);
  }

  // ------------------------------------------------------------------
  // Merge: integrate remote records into local database
  // ------------------------------------------------------------------

  async mergeChanges(
    table: string,
    remoteRecords: any[],
    adapter: SyncAdapter,
    strategy: ConflictStrategy
  ): Promise<SyncResult> {
    const result: SyncResult = {
      pushed: 0,
      pulled: 0,
      conflicts: 0,
      errors: [],
      timestamp: new Date()
    };

    if (!this.db) throw new Error('Database not connected');

    for (const remote of remoteRecords) {
      try {
        await this.mergeSingleRecord(table, remote, adapter, strategy);
      } catch (err) {
        result.conflicts++;
        result.errors.push({
          record: remote,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }

    return result;
  }

  private async mergeSingleRecord(
    table: string,
    remote: any,
    adapter: SyncAdapter,
    strategy: ConflictStrategy
  ): Promise<void> {
    if (!this.db) throw new Error('Database not connected');

    // Pre-fetch pending changes to avoid nested transactions
    const pending = await this.getPendingChanges(table);
    const hasLocalPending = pending.some(c => c.recordId === remote.id);

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([table], 'readwrite');
      const store = tx.objectStore(table);
      const localReq = store.get(remote.id);

      localReq.onsuccess = async () => {
        const local = localReq.result;

        // Case 1: Remote is a tombstone (soft deleted)
        if (remote._deletedAt) {
          if (local) {
            if (hasLocalPending) {
              // Local has un-pushed changes: resolve conflict
              const winner = await adapter.resolveConflict(local, remote, strategy);
              if ((winner as any)._deletedAt) {
                store.put({ ...local, _deletedAt: remote._deletedAt, updatedAt: remote.updatedAt });
              }
              // else keep local (it's the winner)
            } else {
              // No local pending changes: apply remote deletion
              store.put({ ...local, _deletedAt: remote._deletedAt, updatedAt: remote.updatedAt });
            }
          }
          resolve();
          return;
        }

        // Case 2: No local record — insert remote
        if (!local) {
          store.add(remote);
          resolve();
          return;
        }

        // Case 3: Both exist — compare versions/timestamps
        const localVersion = local._version || 0;
        const remoteVersion = remote._version || 0;

        if (remoteVersion > localVersion) {
          store.put(remote);
          resolve();
          return;
        }

        if (localVersion > remoteVersion) {
          resolve();
          return;
        }

        // Same version — check timestamps
        const localTime = new Date(local.updatedAt || 0);
        const remoteTime = new Date(remote.updatedAt || 0);

        if (remoteTime > localTime) {
          store.put(remote);
        }

        resolve();
      };
      localReq.onerror = () => reject(localReq.error);
    });
  }

  // ------------------------------------------------------------------
  // Utilities
  // ------------------------------------------------------------------

  async getPendingCount(table: string): Promise<number> {
    const pending = await this.getPendingChanges(table);
    return pending.length;
  }

  async clearSyncData(table: string): Promise<void> {
    if (!this.db) throw new Error('Database not connected');

    await this.setSyncMeta(table, {
      lastPushAt: null,
      lastPullAt: null,
      lastSyncCursor: null
    });

    const changes = await this.getAllChanges(table);
    for (const change of changes) {
      if (change.id !== undefined) {
        await new Promise<void>((resolve, reject) => {
          const tx = this.db!.transaction(['__sync_changes'], 'readwrite');
          const store = tx.objectStore('__sync_changes');
          const req = store.delete(change.id!);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      }
    }
  }
}
