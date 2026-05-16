// Database class for managing IndexedDB connection and models

export class Database {
  private db: IDBDatabase | null = null;
  private models: Map<string, any> = new Map();

  constructor(private name: string, private version: number) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, this.version);

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
}
