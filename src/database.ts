// Database class for managing IndexedDB / StorageAdapter connection and models

import { SyncEngine, SyncOptions } from './sync-engine.js';
import { SyncAdapter, SyncResult, ConflictStrategy, IndexDef } from './sync-adapter.js';
import { ActiveRecord, ActiveRecordDefaults } from './activerecord.js';
import { StorageAdapter, IndexedDBStorageAdapter } from './storage-adapter.js';
import { TursoAdapter } from './adapters/turso-adapter.js';

export interface AutoSyncOptions {
  debounceMs?: number;
  pollIntervalMs?: number;
  syncOptions?: SyncOptions;
  onSync?: (table: string, result: SyncResult) => void;
  onError?: (table: string, error: Error) => void;
}

export interface DatabaseSyncOptions {
  url: string;
  auto?: boolean;
  interval?: number;
  pollIntervalMs?: number;
  offlineQueue?: boolean;
  headers?: Record<string, string>;
  getAuthHeaders?: () => Promise<Record<string, string>> | Record<string, string>;
  credentials?: RequestCredentials;
  autoProvision?: boolean;
  conflictStrategy?: ConflictStrategy;
}

export interface DatabaseOptions {
  version?: number;
  storage?: StorageAdapter;
  sync?: DatabaseSyncOptions;
  defaults?: ActiveRecordDefaults;
}

export interface SyncShorthandOptions {
  url: string;
  headers?: Record<string, string>;
  getAuthHeaders?: () => Promise<Record<string, string>> | Record<string, string>;
  credentials?: RequestCredentials;
  autoProvision?: boolean;
  conflictStrategy?: ConflictStrategy;
}

export class Database {
  private static _defaultDb: Database | null = null;

  static getDefault(name = 'app_db'): Database {
    if (!Database._defaultDb) {
      Database._defaultDb = new Database(name);
    }
    return Database._defaultDb;
  }

  static setDefault(db: Database): void {
    Database._defaultDb = db;
  }

  static get default(): Database {
    return Database.getDefault();
  }

  static set default(db: Database) {
    Database.setDefault(db);
  }

  private db: IDBDatabase | null = null;
  private storage: StorageAdapter | null = null;
  private storageConnected = false;
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
  private onlineListenerAttached: boolean = false;

  private version?: number;
  private options?: DatabaseOptions;
  private cachedHttpAdapters: Map<string, TursoAdapter> = new Map();

  constructor(
    private name: string,
    optionsOrVersion?: number | DatabaseOptions
  ) {
    if (typeof optionsOrVersion === 'number') {
      this.version = optionsOrVersion;
    } else if (optionsOrVersion && typeof optionsOrVersion === 'object') {
      this.options = optionsOrVersion;
      this.version = optionsOrVersion.version;
      if (optionsOrVersion.storage) {
        this.storage = optionsOrVersion.storage;
      }
      if (optionsOrVersion.defaults) {
        ActiveRecord.defaults = {
          ...ActiveRecord.defaults,
          ...optionsOrVersion.defaults
        };
      }
    }

    if (!Database._defaultDb) {
      Database._defaultDb = this;
    }
  }

  getStorage(): StorageAdapter | null {
    return this.storage;
  }

  getName(): string {
    return this.name;
  }

  hasModel(tableName: string): boolean {
    return this.models.has(tableName);
  }

  isConnected(): boolean {
    return this.db !== null || (this.storage !== null && this.storageConnected);
  }

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
    if (typeof globalThis.indexedDB === 'undefined') {
      return Promise.reject(
        new Error(
          'IndexedDB is not available in this environment. Database operations require a browser environment or an IndexedDB polyfill.'
        )
      );
    }
    return new Promise((resolve, reject) => {
      const probe = globalThis.indexedDB.open(this.name);
      probe.onerror = () => reject(probe.error);
      probe.onsuccess = () => {
        const current = probe.result.version;
        probe.result.close();
        const needed = this.needsUpgrade(probe.result);
        resolve(needed ? current + 1 : current);
      };
      probe.onupgradeneeded = (event) => {
        (event.target as IDBOpenDBRequest).result.close();
        resolve(2);
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
    // If a custom storage adapter is configured (e.g. TursoStorageAdapter), use it directly
    if (this.storage) {
      await this.storage.connect();
      this.storageConnected = true;

      // Ensure stores for all registered models
      for (const [tableName, model] of this.models) {
        const declaredCols = model?.getColumnDefs?.() ?? undefined;
        const indexes = model?.indexes;
        await this.storage.ensureStore(tableName, {
          columns: declaredCols,
          indexes
        });
        model.setStorage(this.storage);
        model.setModelRegistry(this.models);
      }
      this.validateRelationships();

      // Configure constructor sync if requested
      if (this.options?.sync) {
        await this.setupConstructorSync(this.options.sync);
      }
      return;
    }

    if (typeof globalThis.indexedDB === 'undefined') {
      throw new Error(
        'IndexedDB is not available in this environment. Database operations require a browser environment or an IndexedDB polyfill.'
      );
    }

    const version = this.version ?? (await this.resolveVersion());
    return new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open(this.name, version);

      request.onerror = () => reject(request.error);
      request.onsuccess = async () => {
        this.db = request.result;
        const idbStorage = new IndexedDBStorageAdapter(this.db);
        this.models.forEach((model) => {
          model.setDatabase(this.db!);
          model.setStorage(idbStorage);
          model.setModelRegistry(this.models);
        });
        this.validateRelationships();

        // Configure constructor sync if requested
        if (this.options?.sync) {
          try {
            await this.setupConstructorSync(this.options.sync);
          } catch (err) {
            console.error('Failed to initialize constructor sync:', err);
          }
        }

        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        this.handleUpgrade(db);
      };
    });
  }

  private async setupConstructorSync(syncOpts: DatabaseSyncOptions): Promise<void> {
    const adapter = new TursoAdapter();
    await adapter.connect({
      url: syncOpts.url,
      headers: syncOpts.headers,
      getAuthHeaders: syncOpts.getAuthHeaders,
      credentials: syncOpts.credentials
    });

    if (syncOpts.auto !== false) {
      const pollInterval = syncOpts.interval ?? syncOpts.pollIntervalMs;
      this.enableAutoSync(adapter, {
        pollIntervalMs: pollInterval,
        syncOptions: {
          strategy: syncOpts.conflictStrategy
        }
      });
    }

    if (syncOpts.offlineQueue !== false && typeof window !== 'undefined' && window.addEventListener) {
      if (!this.onlineListenerAttached) {
        this.onlineListenerAttached = true;
        window.addEventListener('online', () => {
          this.flushAutoSync();
        });
      }
    }
  }

  registerModel(model: any): void {
    this.models.set(model.tableName, model);
    model.setModelRegistry(this.models);
    if (this.storage) {
      model.setStorage(this.storage);
    }
    if (this.db) {
      model.setDatabase(this.db);
    }
  }

  private validateRelationships(): void {
    const relationshipKinds = ['hasOne', 'hasMany', 'belongsTo'] as const;
    for (const [tableName, model] of this.models) {
      for (const kind of relationshipKinds) {
        const definitions = model[kind] as Record<string, unknown> | undefined;
        if (!definitions) continue;
        for (const [relationshipName, relatedModel] of Object.entries(definitions)) {
          if (typeof relatedModel !== 'string') continue;
          if (!this.models.has(relatedModel)) {
            throw new Error(
              `${tableName}.${kind}.${relationshipName} references unknown table "${relatedModel}"`
            );
          }
        }
      }
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
    if (this.storage) {
      await this.storage.disconnect();
      this.storageConnected = false;
    }
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async migrateUp(): Promise<void> {
    if (!this.isConnected()) throw new Error('Database not connected');
  }

  getDB(): IDBDatabase {
    if (!this.db) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.db;
  }

  getSyncEngine(): SyncEngine {
    if (!this.db && !this.storage) throw new Error('Database not connected. Call connect() first.');
    if (!this.engine) {
      this.engine = new SyncEngine();
      if (this.db) {
        this.engine.setDatabase(this.db);
      }
      if (this.syncUser) {
        this.engine.setUser(this.syncUser);
      }
    }
    return this.engine;
  }

  private async resolveAdapter(adapterOrOptions: SyncAdapter | SyncShorthandOptions): Promise<SyncAdapter> {
    if ('pull' in adapterOrOptions && typeof (adapterOrOptions as any).pull === 'function') {
      return adapterOrOptions as SyncAdapter;
    }

    const opts = adapterOrOptions as SyncShorthandOptions;
    const cacheKey = `${opts.url}`;
    let adapter = this.cachedHttpAdapters.get(cacheKey);
    if (!adapter) {
      adapter = new TursoAdapter();
      await adapter.connect({
        url: opts.url,
        headers: opts.headers,
        getAuthHeaders: opts.getAuthHeaders,
        credentials: opts.credentials
      });
      this.cachedHttpAdapters.set(cacheKey, adapter);
    }
    return adapter;
  }

  async sync(
    table: string,
    adapterOrOptions: SyncAdapter | SyncShorthandOptions,
    options?: SyncOptions
  ): Promise<SyncResult> {
    const adapter = await this.resolveAdapter(adapterOrOptions);
    return this.getSyncEngine().sync(table, adapter, this.withModelColumns(table, options));
  }

  /**
   * Syncs all sync-enabled registered models and returns aggregated per-table results.
   */
  async syncAll(
    adapterOrOptions?: SyncAdapter | SyncShorthandOptions,
    options?: SyncOptions
  ): Promise<Record<string, SyncResult>> {
    let resolvedAdapter: SyncAdapter;
    if (adapterOrOptions) {
      resolvedAdapter = await this.resolveAdapter(adapterOrOptions);
    } else if (this.autoSyncAdapter) {
      resolvedAdapter = this.autoSyncAdapter;
    } else if (this.options?.sync?.url) {
      resolvedAdapter = await this.resolveAdapter({ url: this.options.sync.url });
    } else {
      throw new Error(
        'syncAll requires a SyncAdapter or { url } options when no default sync adapter is configured.'
      );
    }

    const results: Record<string, SyncResult> = {};
    for (const [tableName, model] of this.models) {
      if (model.isSyncEnabled || model.enableSync) {
        results[tableName] = await this.sync(tableName, resolvedAdapter, options);
      }
    }
    return results;
  }

  async backfillSync(tableName?: string): Promise<{
    tables: string[];
    queuedCount: number;
    skippedCount: number;
  }> {
    if (!this.db && !this.storage) throw new Error('Database not connected. Call connect() first.');

    let targetTables: string[] = [];
    if (tableName) {
      targetTables = [tableName];
    } else {
      for (const [table, modelClass] of this.models.entries()) {
        if (modelClass.isSyncEnabled || modelClass.enableSync) {
          targetTables.push(table);
        }
      }
    }

    const engine = this.getSyncEngine();
    let totalQueued = 0;
    let totalSkipped = 0;

    for (const table of targetTables) {
      const result = await engine.backfill(table);
      totalQueued += result.queuedCount;
      totalSkipped += result.skippedCount;
    }

    return {
      tables: targetTables,
      queuedCount: totalQueued,
      skippedCount: totalSkipped
    };
  }

  /**
   * Merge declared `static columns` and `static indexes` from the registered model
   * into the SyncOptions passed to the engine. Caller-supplied options take precedence.
   */
  private withModelColumns(table: string, options?: SyncOptions): SyncOptions {
    const opts: SyncOptions = { ...(options || {}) };
    const model = this.models.get(table);
    if (!opts.columns) {
      const declared = model?.getColumnDefs?.();
      if (declared && declared.length > 0) opts.columns = declared;
    }
    if (!opts.indexes && model?.indexes && Array.isArray(model.indexes)) {
      opts.indexes = model.indexes.map((idx: any): IndexDef => ({
        name: idx.name || `idx_${table}_${Array.isArray(idx.keyPath) ? idx.keyPath.join('_') : idx.keyPath}`,
        columns: Array.isArray(idx.keyPath) ? idx.keyPath : [idx.keyPath],
        unique: Boolean(idx.unique)
      }));
    }
    return opts;
  }

  enableAutoSync(adapter: SyncAdapter, options: AutoSyncOptions = {}): void {
    this.autoSyncAdapter = adapter;
    this.autoSyncOpts = options;

    ActiveRecord.setChangeListener((table: string) => {
      const model = this.models.get(table);
      if (!model || (!model.isSyncEnabled && !model.enableSync)) return;
      this.pendingSyncTables.add(table);
      this.scheduleDebouncedSync();
    });

    if (options.pollIntervalMs && options.pollIntervalMs > 0) {
      this.pollTimer = setInterval(() => {
        for (const [tableName, model] of this.models) {
          if (model.isSyncEnabled || model.enableSync) this.pendingSyncTables.add(tableName);
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
            const result = await engine.sync(
              table,
              this.autoSyncAdapter!,
              this.withModelColumns(table, this.autoSyncOpts.syncOptions)
            );
            this.autoSyncOpts.onSync?.(table, result);
          } catch (err) {
            this.autoSyncOpts.onError?.(table, err instanceof Error ? err : new Error(String(err)));
          }
        })
      );
    } finally {
      this.inFlight = false;
      if (this.pendingSyncTables.size > 0) {
        this.scheduleDebouncedSync();
      }
    }
  }

  /**
   * Introspect this database and return a readable summary tree.
   */
  explain(): string {
    const lines: string[] = [];
    lines.push(`Database: "${this.name}"`);
    lines.push(`  Connected: ${this.isConnected() ? 'yes' : 'no'}`);
    lines.push(`  Storage: ${this.storage ? 'StorageAdapter (' + this.storage.constructor.name + ')' : 'IndexedDB'}`);
    lines.push(`  Sync User: ${this.syncUser ?? '(none)'}`);
    lines.push(`  Auto-Sync: ${this.autoSyncAdapter ? 'enabled' : 'disabled'}`);
    lines.push(`  Registered Models (${this.models.size}):`);
    for (const [table, model] of this.models) {
      lines.push(`    - ${table} (${model.name || 'Anonymous'}) [sync: ${model.isSyncEnabled || model.enableSync ? 'yes' : 'no'}]`);
    }
    return lines.join('\n');
  }
}

// Wire the default Database provider into ActiveRecord for seamless zero-config auto-connect
ActiveRecord.setDefaultDatabaseProvider(() => Database.getDefault());
