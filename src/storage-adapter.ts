// Storage Adapter Interface and Default IndexedDB Storage Adapter
// Provides pluggable persistence for ActiveRecord models, enabling direct
// server/SSR querying without IndexedDB (e.g. TursoStorageAdapter).

export interface StorageQuery {
  where?: Array<{ field: string; operator: string; value: unknown }>;
  orderBy?: { field: string; direction: 'asc' | 'desc' };
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
}

export interface StoreOptions {
  keyPath?: string;
  autoIncrement?: boolean;
  indexes?: Array<{ name: string; keyPath: string | string[]; unique?: boolean }>;
  columns?: Array<{
    name: string;
    type: string;
    nullable?: boolean;
    default?: unknown;
    primaryKey?: boolean;
    autoIncrement?: boolean;
  }>;
}

export interface StorageAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  ensureStore(tableName: string, options?: StoreOptions): Promise<void>;
  get<T = any>(tableName: string, id: IDBValidKey): Promise<T | null>;
  getAll<T = any>(tableName: string, query?: StorageQuery): Promise<T[]>;
  put<T = any>(tableName: string, record: T): Promise<T>;
  delete(tableName: string, id: IDBValidKey): Promise<boolean>;
  clear(tableName: string): Promise<void>;
  transaction?<R>(
    tableNames: string[],
    mode: 'readonly' | 'readwrite',
    callback: () => Promise<R>
  ): Promise<R>;
}

/**
 * Default IndexedDB storage adapter wrapping an IDBDatabase instance.
 * Preserves 100% of existing browser IndexedDB behavior.
 */
export class IndexedDBStorageAdapter implements StorageAdapter {
  private db: IDBDatabase | null = null;

  constructor(private dbOrName?: IDBDatabase | string, private version?: number) {
    if (typeof dbOrName === 'object' && dbOrName !== null) {
      this.db = dbOrName as IDBDatabase;
    }
  }

  setDatabase(db: IDBDatabase): void {
    this.db = db;
  }

  getDatabase(): IDBDatabase | null {
    return this.db;
  }

  async connect(): Promise<void> {
    if (this.db) return;
    if (typeof globalThis.indexedDB === 'undefined') {
      throw new Error(
        'IndexedDB is not available in this environment. Database operations require a browser environment or an IndexedDB polyfill.'
      );
    }
    const name = typeof this.dbOrName === 'string' ? this.dbOrName : 'app_db';
    return new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open(name, this.version);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      request.onupgradeneeded = () => {
        // Upgrade handled externally or via Database
      };
    });
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private requireDB(): IDBDatabase {
    if (!this.db) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.db;
  }

  async ensureStore(tableName: string, _options: StoreOptions = {}): Promise<void> {
    const db = this.requireDB();
    if (db.objectStoreNames.contains(tableName)) return;
    // Note: Creating stores in IDB requires a versionchange transaction
    // This is handled by Database during handleUpgrade
  }

  async get<T = any>(tableName: string, id: IDBValidKey): Promise<T | null> {
    const db = this.requireDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([tableName], 'readonly');
      const store = tx.objectStore(tableName);
      const request = store.get(id as any);
      request.onsuccess = () => resolve((request.result as T) ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async getAll<T = any>(tableName: string, query?: StorageQuery): Promise<T[]> {
    const db = this.requireDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([tableName], 'readonly');
      const store = tx.objectStore(tableName);
      const request = store.getAll();

      request.onsuccess = () => {
        let results = request.result as any[];

        if (!query?.includeDeleted) {
          results = results.filter((item: any) => !item._deletedAt);
        }

        if (query?.where && query.where.length > 0) {
          results = results.filter((item: any) => {
            return query.where!.every(condition => {
              const itemValue = item[condition.field];
              switch (condition.operator) {
                case '=':
                  return itemValue === condition.value;
                case '!=':
                  return itemValue !== condition.value;
                case '>':
                  return itemValue > (condition.value as any);
                case '>=':
                  return itemValue >= (condition.value as any);
                case '<':
                  return itemValue < (condition.value as any);
                case '<=':
                  return itemValue <= (condition.value as any);
                case 'like':
                  return (
                    itemValue &&
                    itemValue
                      .toString()
                      .includes(String(condition.value).replace(/%/g, ''))
                  );
                default:
                  return true;
              }
            });
          });
        }

        if (query?.orderBy) {
          const { field, direction } = query.orderBy;
          results.sort((a: any, b: any) => {
            const aVal = a[field];
            const bVal = b[field];
            const comparison = aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
            return direction === 'desc' ? -comparison : comparison;
          });
        }

        if (query?.offset) {
          results = results.slice(query.offset);
        }

        if (query?.limit) {
          results = results.slice(0, query.limit);
        }

        resolve(results as T[]);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async put<T = any>(tableName: string, record: T): Promise<T> {
    const db = this.requireDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([tableName], 'readwrite');
      const store = tx.objectStore(tableName);
      const request = store.put(record);
      request.onsuccess = () => resolve(record);
      request.onerror = () => reject(request.error);
    });
  }

  async delete(tableName: string, id: IDBValidKey): Promise<boolean> {
    const db = this.requireDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([tableName], 'readwrite');
      const store = tx.objectStore(tableName);
      const request = store.delete(id as any);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  async clear(tableName: string): Promise<void> {
    const db = this.requireDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([tableName], 'readwrite');
      const store = tx.objectStore(tableName);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async transaction<R>(
    tableNames: string[],
    mode: 'readonly' | 'readwrite',
    callback: () => Promise<R>
  ): Promise<R> {
    const db = this.requireDB();
    const tx = db.transaction(tableNames, mode);
    try {
      const result = await callback();
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return result;
    } catch (err) {
      tx.abort();
      throw err;
    }
  }
}
