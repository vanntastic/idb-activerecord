// Database class for managing IndexedDB connection and models

import { SyncEngine, SyncOptions } from './sync-engine.js';
import { SyncAdapter, SyncResult } from './sync-adapter.js';
import { ActiveRecord } from './activerecord.js';

export interface AutoSyncOptions {
  debounceMs?: number;
  pollIntervalMs?: number;
  syncOptions?: SyncOptions;
  onSync?: (table: string, result: SyncResult) => void;
  onError?: (table: string, error: Error) => void;
}

export class Database {
  private db: IDBDatabase | null = null;
  private models: Map<string, any> = new Map();
  private engine: SyncEngine | null = null;
  private syncUser: string | null = null;

  // Auto-sync state
  private autoSyncAdapter: SyncAdapter | null = null;
  private autoSyncOpts: AutoSyncOptions = {};
  private pendingSyncTables: Set<string> = new Set();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private inFlight: boolean = false;

  constructor(private name: string, private version?: number) {}

  setUser(userId: string): void {
    this.syncUser = userId;
    if (this.engine) {
      this.engine.setUser(userId);
    }
  }

  getUser(): string | null {
    return this.syncUser;
  }

  private resolveVersion(): Promise<number> {
    return new Promise((resolve, reject) => {
      const probe = indexedDB.open(this.name);
      probe.onerror = () => reject(probe.error);
      probe.onsuccess = () => {
        const current = probe.result.version;
        probe.result.close();
        const needed = this.needsUpgrade(probe.result);
        resolve(needed ? current + 1 : current);
      };
      probe.onupgradeneeded = (event) => {
        (event.target as IDBOpenDBRequest).result.close();
        resolve(1);
      };
    });
  }

  private needsUpgrade(db: IDBDatabase): boolean {
    for (const [tableName] of this.models) {
      if (!db.objectStoreNames.contains(tableName)) return true;
    }
    if (!db.objectStoreNames.contains('__sync_meta')) return true;
    if (!db.objectStoreNames.contains('__sync_changes')) return true;
    return false;
  }

  async connect(): Promise<void> {
    const version = this.version ?? await this.resolveVersion();
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        // Set database on all registered models
        this.models.forEach((model) => {
          model.setDatabase(this.db!);
        });
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        this.handleUpgrade(db);
      };
    });
  }

  registerModel(model: any): void {
    this.models.set(model.tableName, model);
    if (this.db) {
      model.setDatabase(this.db);
    }
  }

  private handleUpgrade(db: IDBDatabase): void {
    // Create object stores for registered models
    this.models.forEach((model, tableName) => {
      if (!db.objectStoreNames.contains(tableName)) {
        const store = db.createObjectStore(tableName, {
          keyPath: 'id',
          autoIncrement: true
        });

        // Add indexes if defined
        if (model.indexes) {
          model.indexes.forEach((index: any) => {
            store.createIndex(index.name, index.keyPath, {
              unique: index.unique || false
            });
          });
        }
      }
    });

    // Create internal sync stores
    if (!db.objectStoreNames.contains('__sync_meta')) {
      db.createObjectStore('__sync_meta', { keyPath: 'table' });
    }
    if (!db.objectStoreNames.contains('__sync_changes')) {
      const changeStore = db.createObjectStore('__sync_changes', {
        keyPath: 'id',
        autoIncrement: true
      });
      changeStore.createIndex('table', 'table', { unique: false });
      changeStore.createIndex('synced', 'synced', { unique: false });
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async migrateUp(): Promise<void> {
    if (!this.db) throw new Error('Database not connected');
    // Migration logic would be implemented here
    // This is a placeholder for future migration runner
  }

  getDB(): IDBDatabase {
    if (!this.db) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.db;
  }

  getSyncEngine(): SyncEngine {
    if (!this.db) throw new Error('Database not connected. Call connect() first.');
    if (!this.engine) {
      this.engine = new SyncEngine();
      this.engine.setDatabase(this.db);
      if (this.syncUser) {
        this.engine.setUser(this.syncUser);
      }
    }
    return this.engine;
  }

  async sync(table: string, adapter: SyncAdapter, options?: SyncOptions): Promise<SyncResult> {
    return this.getSyncEngine().sync(table, adapter, options);
  }

  /**
   * Enable automatic syncing. After any CUD operation on a model with
   * enableSync = true, a debounced sync will be scheduled. If pollIntervalMs
   * is set, all sync-enabled tables are also pulled periodically.
   */
  enableAutoSync(adapter: SyncAdapter, options: AutoSyncOptions = {}): void {
    this.autoSyncAdapter = adapter;
    this.autoSyncOpts = options;

    // Subscribe to local change events
    ActiveRecord.setChangeListener((table: string) => {
      const model = this.models.get(table);
      if (!model || !model.enableSync) return;
      this.pendingSyncTables.add(table);
      this.scheduleDebouncedSync();
    });

    // Periodic pull for cross-device updates
    if (options.pollIntervalMs && options.pollIntervalMs > 0) {
      this.pollTimer = setInterval(() => {
        for (const [tableName, model] of this.models) {
          if (model.enableSync) this.pendingSyncTables.add(tableName);
        }
        this.runWhenIdle(() => this.flushAutoSync());
      }, options.pollIntervalMs);
    }
  }

  disableAutoSync(): void {
    ActiveRecord.setChangeListener(null);
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.autoSyncAdapter = null;
    this.pendingSyncTables.clear();
  }

  private scheduleDebouncedSync(): void {
    const debounceMs = this.autoSyncOpts.debounceMs ?? 300;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      // After the debounce settles, defer to an idle window so the sync work
      // (JSON parsing, merge loop) doesn't compete with active rendering.
      this.runWhenIdle(() => this.flushAutoSync());
    }, debounceMs);
  }

  private runWhenIdle(fn: () => void): void {
    const ric = (globalThis as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number)
      | undefined;
    if (typeof ric === 'function') {
      ric(fn, { timeout: 1000 });
    } else {
      setTimeout(fn, 0);
    }
  }

  private async flushAutoSync(): Promise<void> {
    if (this.inFlight || !this.autoSyncAdapter) return;
    if (this.pendingSyncTables.size === 0) return;
    if (!this.autoSyncAdapter.isConnected()) return;

    const tables = Array.from(this.pendingSyncTables);
    this.pendingSyncTables.clear();
    this.inFlight = true;

    try {
      const engine = this.getSyncEngine();
      await Promise.all(
        tables.map(async (table) => {
          try {
            const result = await engine.sync(table, this.autoSyncAdapter!, this.autoSyncOpts.syncOptions);
            this.autoSyncOpts.onSync?.(table, result);
          } catch (err) {
            this.autoSyncOpts.onError?.(table, err instanceof Error ? err : new Error(String(err)));
          }
        })
      );
    } finally {
      this.inFlight = false;
      // If new changes came in during the flush, schedule another run
      if (this.pendingSyncTables.size > 0) {
        this.scheduleDebouncedSync();
      }
    }
  }
}
