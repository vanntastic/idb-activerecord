// Database class for managing IndexedDB connection and models

import { SyncEngine, SyncOptions } from './sync-engine.js';
import { SyncAdapter, SyncResult } from './sync-adapter.js';

export class Database {
  private db: IDBDatabase | null = null;
  private models: Map<string, any> = new Map();
  private engine: SyncEngine | null = null;

  constructor(private name: string, private version?: number) {}

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
    }
    return this.engine;
  }

  async sync(table: string, adapter: SyncAdapter, options?: SyncOptions): Promise<SyncResult> {
    return this.getSyncEngine().sync(table, adapter, options);
  }
}
