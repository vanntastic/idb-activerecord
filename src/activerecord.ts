// Base ActiveRecord class with strict TypeScript generics, pluggable StorageAdapter,
// sensible defaults, auto-discovery & lazy auto-connect, and reactive subscriptions.

import { QueryBuilder } from './query-builder.js';
import { ValidationRule } from './types.js';
import { StorageAdapter } from './storage-adapter.js';

export function singularize(word: string): string {
  if (!word || typeof word !== 'string') return word;
  if (word.endsWith('ies') && word.length > 3) {
    return word.slice(0, -3) + 'y';
  }
  if (word.endsWith('sses') || word.endsWith('xes') || word.endsWith('ches') || word.endsWith('shes')) {
    return word.slice(0, -2);
  }
  if (word.endsWith('uses')) {
    if (
      word.endsWith('tuses') ||
      word.endsWith('ruses') ||
      word.endsWith('nuses') ||
      word.endsWith('puses') ||
      word.endsWith('guses') ||
      word.endsWith('cuses')
    ) {
      return word.slice(0, -2);
    }
    return word.slice(0, -1);
  }
  if (word.endsWith('zzes')) {
    return word.slice(0, -3);
  }
  if (word.endsWith('us') || word.endsWith('is') || word.endsWith('ss')) {
    return word;
  }
  if (word.endsWith('s')) {
    return word.slice(0, -1);
  }
  return word;
}

export interface ActiveRecordDefaults {
  enableSync?: boolean | 'auto';
  softDelete?: boolean;
  timestamps?: boolean;
  versioning?: boolean;
}

export interface MutationEvent {
  table: string;
  action: 'create' | 'update' | 'destroy' | 'restore' | 'sync';
  recordId?: string | number;
  record?: any;
}

export interface LiveQueryOptions {
  debounceMs?: number;
  initialValue?: any;
}

export interface LiveQueryStore<T> {
  subscribe(callback: (data: T) => void): () => void;
  getSnapshot(): T | undefined;
  refresh(): Promise<T>;
}

export type ModelAttributes<T> = {
  [K in keyof T as T[K] extends Function ? never : K]?: T[K];
};

export type ModelConstructor<T extends ActiveRecord = ActiveRecord> = {
  new (...args: any[]): T;
  tableName: string;
  find(id: IDBValidKey): Promise<T | null>;
  all(options?: { withDeleted?: boolean }): Promise<T[]>;
  create(data?: ModelAttributes<T> | Record<string, any>): Promise<T>;
  where(field: string, operator: string, value?: any): QueryBuilder<T>;
  where(field: string, value: any): QueryBuilder<T>;
  onlyDeleted(): QueryBuilder<T>;
  withDeleted(): QueryBuilder<T>;
  restore(id: IDBValidKey): Promise<T | null>;
} & typeof ActiveRecord;

export class ActiveRecord<_T = any> {
  id?: string;
  _version?: number;
  _deletedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;

  protected static db: IDBDatabase | null = null;
  protected static storage: StorageAdapter | null = null;
  protected static _modelRegistry: Map<string, any> | null = null;
  protected static _defaultDbProvider: (() => any) | null = null;

  static tableName: string = '';
  protected static indexes: any[] = [];
  protected static belongsTo: Record<string, any> = {};
  protected static hasMany: Record<string, any> = {};
  protected static hasOne: Record<string, any> = {};
  protected static beforeCreate?: (record: any) => void;
  protected static afterCreate?: (record: any) => void;
  protected static beforeUpdate?: (record: any) => void;
  protected static afterUpdate?: (record: any) => void;
  protected static beforeDestroy?: (record: any) => void;
  protected static afterDestroy?: (record: any) => void;
  protected static validates?: Record<string, ValidationRule>;

  static enableSync: boolean = false;
  static softDelete: boolean = false;
  static timestamps?: boolean;
  static versioning?: boolean;

  /** Global sensible defaults for all ActiveRecord models. */
  static defaults: ActiveRecordDefaults = {};

  private static subscribers: Set<(event: MutationEvent) => void> = new Set();

  /**
   * Optional explicit column declarations. When set, these are the source of
   * truth for the model's schema and are used by SyncEngine to call
   * adapter.ensureTable(). Each entry can omit fields — sensible defaults
   * are applied (nullable: true, type: 'string').
   */
  static columns?: Record<string, Partial<{
    type: string;
    nullable: boolean;
    default: unknown;
    primaryKey: boolean;
    autoIncrement: boolean;
  }>>;

  /**
   * Normalize the static `columns` declaration into a ColumnDef[] array
   * suitable for adapter.ensureTable(). Returns null if no columns declared.
   */
  static getColumnDefs(): Array<{
    name: string;
    type: string;
    nullable: boolean;
    default?: unknown;
    primaryKey?: boolean;
    autoIncrement?: boolean;
  }> | null {
    if (!this.columns) return null;
    return Object.entries(this.columns).map(([name, def]) => ({
      name,
      type: def.type ?? 'string',
      nullable: def.nullable ?? true,
      ...(def.default !== undefined ? { default: def.default } : {}),
      ...(def.primaryKey ? { primaryKey: true } : {}),
      ...(def.autoIncrement ? { autoIncrement: true } : {})
    }));
  }

  errors: string[] = [];

  static setDatabase(db: IDBDatabase): void {
    this.db = db;
  }

  static getDatabase(): IDBDatabase | null {
    return this.db;
  }

  static setStorage(storage: StorageAdapter | null): void {
    this.storage = storage;
  }

  static getStorage(): StorageAdapter | null {
    return this.storage;
  }

  static setModelRegistry(models: Map<string, any>): void {
    this._modelRegistry = models;
  }

  static setDefaultDatabaseProvider(provider: () => any): void {
    this._defaultDbProvider = provider;
  }

  // --- Feature flags respecting defaults with explicit static precedence ---

  static get isSyncEnabled(): boolean {
    if (Object.prototype.hasOwnProperty.call(this, 'enableSync')) {
      return Boolean(this.enableSync);
    }
    return ActiveRecord.defaults.enableSync === true || ActiveRecord.defaults.enableSync === 'auto';
  }

  static get isSoftDeleteEnabled(): boolean {
    if (Object.prototype.hasOwnProperty.call(this, 'softDelete')) {
      return Boolean(this.softDelete);
    }
    return Boolean(ActiveRecord.defaults.softDelete);
  }

  static get isTimestampsEnabled(): boolean {
    if (Object.prototype.hasOwnProperty.call(this, 'timestamps')) {
      return Boolean((this as any).timestamps);
    }
    return Boolean(ActiveRecord.defaults.timestamps || this.isSyncEnabled);
  }

  static get isVersioningEnabled(): boolean {
    if (Object.prototype.hasOwnProperty.call(this, 'versioning')) {
      return Boolean((this as any).versioning);
    }
    return Boolean(ActiveRecord.defaults.versioning || this.isSyncEnabled);
  }

  // --- Auto-discovery and lazy auto-connect ---

  static async ensureReady(): Promise<void> {
    if (this.db || this.storage) return;

    if (!this.tableName && this.name) {
      this.tableName = this.name.toLowerCase() + 's';
    }

    if (this._defaultDbProvider) {
      const db = this._defaultDbProvider();
      if (db) {
        if (!db.hasModel(this.tableName)) {
          db.registerModel(this);
        }
        if (!db.isConnected()) {
          await db.connect();
        }
      }
    }
  }

  // --- Reactive subscriptions ---

  static subscribe(listener: (event: MutationEvent) => void): () => void {
    ActiveRecord.subscribers.add(listener);
    return () => {
      ActiveRecord.subscribers.delete(listener);
    };
  }

  static notifySubscribers(event: MutationEvent): void {
    for (const listener of ActiveRecord.subscribers) {
      try {
        listener(event);
      } catch (err) {
        console.error('ActiveRecord subscriber error:', err);
      }
    }
  }

  // --- CRUD static methods with polymorphic this typing ---

  static async find<M extends typeof ActiveRecord>(
    this: M,
    id: IDBValidKey
  ): Promise<InstanceType<M> | null> {
    await (this as any).ensureReady();

    if ((this as any).storage) {
      const record = await (this as any).storage.get((this as any).tableName, id);
      if (!record) return null;
      const instance = Object.create(this.prototype);
      Object.assign(instance, record);
      ActiveRecord._defineRelationshipAccessors(instance);
      return instance;
    }

    if (!(this as any).db) throw new Error('Database not connected');

    return new Promise((resolve, reject) => {
      const transaction = (this as any).db.transaction([(this as any).tableName], 'readonly');
      const store = transaction.objectStore((this as any).tableName);
      const request = store.get(id as any);

      request.onsuccess = () => {
        if (request.result) {
          const instance = Object.create(this.prototype);
          Object.assign(instance, request.result);
          ActiveRecord._defineRelationshipAccessors(instance);
          resolve(instance);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  static async all<M extends typeof ActiveRecord>(
    this: M,
    options?: { withDeleted?: boolean }
  ): Promise<InstanceType<M>[]> {
    await (this as any).ensureReady();

    if ((this as any).storage) {
      const rows = await (this as any).storage.getAll((this as any).tableName, {
        includeDeleted: options?.withDeleted
      });
      return rows.map((item: any) => {
        const instance = Object.create(this.prototype);
        Object.assign(instance, item);
        ActiveRecord._defineRelationshipAccessors(instance);
        return instance;
      });
    }

    if (!(this as any).db) throw new Error('Database not connected');

    return new Promise((resolve, reject) => {
      const transaction = (this as any).db.transaction([(this as any).tableName], 'readonly');
      const store = transaction.objectStore((this as any).tableName);
      const request = store.getAll();

      request.onsuccess = () => {
        let results = request.result;
        if (!options?.withDeleted && (this as any).isSoftDeleteEnabled) {
          results = results.filter((item: any) => !item._deletedAt);
        }
        results = results.map((item: any) => {
          const instance = Object.create(this.prototype);
          Object.assign(instance, item);
          ActiveRecord._defineRelationshipAccessors(instance);
          return instance;
        });
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  static async withDeleted<M extends typeof ActiveRecord>(
    this: M
  ): Promise<InstanceType<M>[]> {
    return (this as any).all({ withDeleted: true });
  }

  static async onlyDeleted<M extends typeof ActiveRecord>(
    this: M
  ): Promise<InstanceType<M>[]> {
    await (this as any).ensureReady();

    if ((this as any).storage) {
      const rows = await (this as any).storage.getAll((this as any).tableName, {
        includeDeleted: true
      });
      return rows
        .filter((item: any) => Boolean(item._deletedAt))
        .map((item: any) => {
          const instance = Object.create(this.prototype);
          Object.assign(instance, item);
          ActiveRecord._defineRelationshipAccessors(instance);
          return instance;
        });
    }

    if (!(this as any).db) throw new Error('Database not connected');
    return new Promise((resolve, reject) => {
      const transaction = (this as any).db.transaction([(this as any).tableName], 'readonly');
      const store = transaction.objectStore((this as any).tableName);
      const request = store.getAll();
      request.onsuccess = () => {
        const results = request.result
          .filter((item: any) => item._deletedAt)
          .map((item: any) => {
            const instance = Object.create(this.prototype);
            Object.assign(instance, item);
            ActiveRecord._defineRelationshipAccessors(instance);
            return instance;
          });
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  private static generateUUID(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  static async create<M extends typeof ActiveRecord>(
    this: M,
    data: ModelAttributes<InstanceType<M>> | Record<string, any> = {}
  ): Promise<InstanceType<M>> {
    await (this as any).ensureReady();

    const payload = { ...(data as any) };
    const id = payload.id || ActiveRecord.generateUUID();
    payload.id = id;

    const now = new Date().toISOString();
    if ((this as any).isTimestampsEnabled) {
      payload.createdAt = payload.createdAt || now;
      payload.updatedAt = payload.updatedAt || now;
    }
    if ((this as any).isVersioningEnabled) {
      payload._version = payload._version || 1;
    }

    // Run beforeCreate callback
    if ((this as any).beforeCreate) {
      (this as any).beforeCreate(payload);
    }

    const instance = Object.create(this.prototype);
    Object.assign(instance, payload);
    ActiveRecord._defineRelationshipAccessors(instance);

    if ((this as any).storage) {
      await (this as any).storage.put((this as any).tableName, payload);

      if ((this as any).afterCreate) {
        (this as any).afterCreate(instance);
      }

      if ((this as any).isSyncEnabled && (this as any).db) {
        ActiveRecord.logChange((this as any).db, (this as any).tableName, id, 'create', instance);
      }

      ActiveRecord.notifySubscribers({
        table: (this as any).tableName,
        action: 'create',
        recordId: id,
        record: instance
      });

      return instance;
    }

    if (!(this as any).db) throw new Error('Database not connected');

    return new Promise((resolve, reject) => {
      const transaction = (this as any).db.transaction([(this as any).tableName], 'readwrite');
      const store = transaction.objectStore((this as any).tableName);
      const request = store.add(payload);

      request.onsuccess = () => {
        if ((this as any).afterCreate) {
          (this as any).afterCreate(instance);
        }

        if ((this as any).isSyncEnabled) {
          ActiveRecord.logChange((this as any).db, (this as any).tableName, id, 'create', instance);
        }

        ActiveRecord.notifySubscribers({
          table: (this as any).tableName,
          action: 'create',
          recordId: id,
          record: instance
        });

        resolve(instance);
      };
      request.onerror = () => reject(request.error);
    });
  }

  static where<M extends typeof ActiveRecord>(
    this: M,
    field: string,
    operator: string,
    value?: any
  ): QueryBuilder<InstanceType<M>>;
  static where<M extends typeof ActiveRecord>(
    this: M,
    field: string,
    value: any
  ): QueryBuilder<InstanceType<M>>;
  static where<M extends typeof ActiveRecord>(
    this: M,
    field: string,
    operatorOrValue: any,
    value?: any
  ): QueryBuilder<InstanceType<M>> {
    const qb = new QueryBuilder<InstanceType<M>>(
      (this as any).tableName,
      (this as any).db,
      this,
      (this as any).storage
    );
    return qb.where(field, operatorOrValue, value);
  }

  static async transaction(callback: () => Promise<void>): Promise<void> {
    await this.ensureReady();

    if (this.storage?.transaction) {
      return this.storage.transaction([this.tableName], 'readwrite', callback);
    }

    if (!this.db) throw new Error('Database not connected');

    const transaction = this.db.transaction([this.tableName], 'readwrite');
    try {
      await callback();
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } catch (error) {
      transaction.abort();
      throw error;
    }
  }

  async update(data: any): Promise<void> {
    const constructor = this.constructor as typeof ActiveRecord;
    await (constructor as any).ensureReady();

    if (constructor.beforeUpdate) {
      constructor.beforeUpdate(this);
    }

    const updatedData = { ...this, ...data };
    const now = new Date().toISOString();

    if (constructor.isTimestampsEnabled) {
      updatedData.updatedAt = now;
      this.updatedAt = now;
    }
    if (constructor.isVersioningEnabled) {
      updatedData._version = (updatedData._version || 0) + 1;
      this._version = updatedData._version;
    }

    if (constructor.storage) {
      await constructor.storage.put(constructor.tableName, updatedData);
      Object.assign(this, data);
      if (constructor.isTimestampsEnabled) {
        Object.assign(this, { updatedAt: updatedData.updatedAt });
      }
      if (constructor.isVersioningEnabled) {
        Object.assign(this, { _version: updatedData._version });
      }

      if (constructor.afterUpdate) {
        constructor.afterUpdate(this);
      }

      if (constructor.isSyncEnabled && constructor.db) {
        ActiveRecord.logChange(constructor.db, constructor.tableName, this.id!, 'update', updatedData);
      }

      ActiveRecord.notifySubscribers({
        table: constructor.tableName,
        action: 'update',
        recordId: this.id,
        record: this
      });
      return;
    }

    if (!constructor.db) throw new Error('Database not connected');

    return new Promise((resolve, reject) => {
      const transaction = constructor.db!.transaction([constructor.tableName], 'readwrite');
      const store = transaction.objectStore(constructor.tableName);
      const request = store.put(updatedData);

      request.onsuccess = () => {
        Object.assign(this, data);
        if (constructor.isTimestampsEnabled) {
          Object.assign(this, { updatedAt: updatedData.updatedAt });
        }
        if (constructor.isVersioningEnabled) {
          Object.assign(this, { _version: updatedData._version });
        }

        if (constructor.afterUpdate) {
          constructor.afterUpdate(this);
        }

        if (constructor.isSyncEnabled) {
          ActiveRecord.logChange(constructor.db!, constructor.tableName, this.id!, 'update', updatedData);
        }

        ActiveRecord.notifySubscribers({
          table: constructor.tableName,
          action: 'update',
          recordId: this.id,
          record: this
        });

        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  async destroy(): Promise<void> {
    const constructor = this.constructor as typeof ActiveRecord;
    await (constructor as any).ensureReady();
    if (!this.id) throw new Error('Cannot destroy record without an ID');

    if (constructor.beforeDestroy) {
      constructor.beforeDestroy(this);
    }

    const now = new Date().toISOString();

    if (constructor.isSoftDeleteEnabled) {
      const deletedData: any = { ...this, _deletedAt: now };
      if (constructor.isTimestampsEnabled) {
        deletedData.updatedAt = now;
        this.updatedAt = now;
      }
      if (constructor.isVersioningEnabled) {
        deletedData._version = (deletedData._version || 0) + 1;
        this._version = deletedData._version;
      }

      if (constructor.storage) {
        await constructor.storage.put(constructor.tableName, deletedData);
        Object.assign(this, { _deletedAt: now });

        if (constructor.afterDestroy) {
          constructor.afterDestroy(this);
        }

        if (constructor.isSyncEnabled && constructor.db) {
          ActiveRecord.logChange(constructor.db, constructor.tableName, this.id!, 'delete', deletedData);
        }

        ActiveRecord.notifySubscribers({
          table: constructor.tableName,
          action: 'destroy',
          recordId: this.id,
          record: this
        });
        return;
      }

      if (!constructor.db) throw new Error('Database not connected');

      return new Promise((resolve, reject) => {
        const transaction = constructor.db!.transaction([constructor.tableName], 'readwrite');
        const store = transaction.objectStore(constructor.tableName);
        const request = store.put(deletedData);

        request.onsuccess = () => {
          Object.assign(this, { _deletedAt: now });
          if (constructor.isTimestampsEnabled) {
            Object.assign(this, { updatedAt: now });
          }
          if (constructor.isVersioningEnabled) {
            Object.assign(this, { _version: deletedData._version });
          }

          if (constructor.afterDestroy) {
            constructor.afterDestroy(this);
          }

          if (constructor.isSyncEnabled) {
            ActiveRecord.logChange(constructor.db!, constructor.tableName, this.id!, 'delete', deletedData);
          }

          ActiveRecord.notifySubscribers({
            table: constructor.tableName,
            action: 'destroy',
            recordId: this.id,
            record: this
          });

          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    }

    // Hard delete
    if (constructor.storage) {
      await constructor.storage.delete(constructor.tableName, this.id!);

      if (constructor.afterDestroy) {
        constructor.afterDestroy(this);
      }

      if (constructor.isSyncEnabled && constructor.db) {
        ActiveRecord.logChange(constructor.db, constructor.tableName, this.id!, 'delete', { id: this.id });
      }

      ActiveRecord.notifySubscribers({
        table: constructor.tableName,
        action: 'destroy',
        recordId: this.id
      });
      return;
    }

    if (!constructor.db) throw new Error('Database not connected');

    return new Promise((resolve, reject) => {
      const transaction = constructor.db!.transaction([constructor.tableName], 'readwrite');
      const store = transaction.objectStore(constructor.tableName);
      const request = store.delete(this.id!);

      request.onsuccess = () => {
        if (constructor.afterDestroy) {
          constructor.afterDestroy(this);
        }

        if (constructor.isSyncEnabled) {
          ActiveRecord.logChange(constructor.db!, constructor.tableName, this.id!, 'delete', { id: this.id });
        }

        ActiveRecord.notifySubscribers({
          table: constructor.tableName,
          action: 'destroy',
          recordId: this.id
        });

        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  static async restore<M extends typeof ActiveRecord>(
    this: M,
    id: IDBValidKey
  ): Promise<InstanceType<M> | null> {
    await (this as any).ensureReady();
    if (!(this as any).isSoftDeleteEnabled) throw new Error('softDelete is not enabled');

    if ((this as any).storage) {
      const record = await (this as any).storage.get((this as any).tableName, id);
      if (!record) throw new Error('Record not found');
      if (!record._deletedAt) throw new Error('Record is not deleted');

      const restored = { ...record, _deletedAt: null };
      const now = new Date().toISOString();
      if ((this as any).isTimestampsEnabled) {
        restored.updatedAt = now;
      }
      if ((this as any).isVersioningEnabled) {
        restored._version = (restored._version || 0) + 1;
      }

      await (this as any).storage.put((this as any).tableName, restored);
      const instance = Object.create(this.prototype);
      Object.assign(instance, restored);
      ActiveRecord._defineRelationshipAccessors(instance);

      if ((this as any).isSyncEnabled && (this as any).db) {
        ActiveRecord.logChange((this as any).db, (this as any).tableName, id as any, 'update', restored);
      }

      ActiveRecord.notifySubscribers({
        table: (this as any).tableName,
        action: 'restore',
        recordId: id as any,
        record: instance
      });

      return instance;
    }

    if (!(this as any).db) throw new Error('Database not connected');

    return new Promise((resolve, reject) => {
      const transaction = (this as any).db.transaction([(this as any).tableName], 'readwrite');
      const store = transaction.objectStore((this as any).tableName);
      const request = store.get(id as any);

      request.onsuccess = () => {
        const record = request.result;
        if (!record) return reject(new Error('Record not found'));
        if (!record._deletedAt) return reject(new Error('Record is not deleted'));

        const restored = { ...record, _deletedAt: null };
        const now = new Date().toISOString();
        if ((this as any).isTimestampsEnabled) {
          restored.updatedAt = now;
        }
        if ((this as any).isVersioningEnabled) {
          restored._version = (restored._version || 0) + 1;
        }

        const putReq = store.put(restored);
        putReq.onsuccess = () => {
          const instance = Object.create(this.prototype);
          Object.assign(instance, restored);
          ActiveRecord._defineRelationshipAccessors(instance);

          if ((this as any).isSyncEnabled) {
            ActiveRecord.logChange((this as any).db, (this as any).tableName, id as any, 'update', restored);
          }

          ActiveRecord.notifySubscribers({
            table: (this as any).tableName,
            action: 'restore',
            recordId: id as any,
            record: instance
          });

          resolve(instance);
        };
        putReq.onerror = () => reject(putReq.error);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // --- Change listener for Database auto-sync ---

  private static changeListener: ((table: string) => void) | null = null;

  static setChangeListener(listener: ((table: string) => void) | null): void {
    ActiveRecord.changeListener = listener;
  }

  static logChange(
    db: IDBDatabase,
    table: string,
    recordId: string | number,
    action: 'create' | 'update' | 'delete',
    data: any
  ): void {
    if (!db.objectStoreNames.contains('__sync_changes')) return;

    try {
      const tx = db.transaction(['__sync_changes'], 'readwrite');
      const store = tx.objectStore('__sync_changes');
      store.add({
        table,
        recordId,
        action,
        data,
        timestamp: new Date().toISOString(),
        synced: false
      });
      tx.oncomplete = () => {
        if (ActiveRecord.changeListener) {
          try {
            ActiveRecord.changeListener(table);
          } catch {
            // ignore
          }
        }
      };
    } catch {
      // Silently fail if sync stores aren't ready
    }
  }

  async isValid(): Promise<boolean> {
    this.errors = [];
    const constructor = this.constructor as typeof ActiveRecord;

    if (!constructor.validates) return true;

    for (const [field, rules] of Object.entries(constructor.validates)) {
      const value = (this as any)[field];

      if (rules.presence && (!value || value === '')) {
        this.errors.push(`${field} cannot be blank`);
      }

      if (rules.length && value) {
        if (rules.length.minimum && value.length < rules.length.minimum) {
          this.errors.push(`${field} is too short (minimum is ${rules.length.minimum} characters)`);
        }
        if (rules.length.maximum && value.length > rules.length.maximum) {
          this.errors.push(`${field} is too long (maximum is ${rules.length.maximum} characters)`);
        }
      }

      if (rules.format && value && !rules.format.test(value)) {
        this.errors.push(`${field} is invalid`);
      }
    }

    return this.errors.length === 0;
  }

  static _defineRelationshipAccessors(instance: any): void {
    const constructor = instance.constructor as typeof ActiveRecord;
    for (const key of Object.keys(constructor.hasOne ?? {})) {
      if (!(key in instance)) {
        Object.defineProperty(instance, key, {
          get() {
            return (this as any).hasOne(key);
          },
          configurable: true,
          enumerable: false
        });
      }
    }
    for (const key of Object.keys(constructor.hasMany ?? {})) {
      if (!(key in instance)) {
        Object.defineProperty(instance, key, {
          get() {
            return (this as any).hasMany(key);
          },
          configurable: true,
          enumerable: false
        });
      }
    }
    for (const key of Object.keys(constructor.belongsTo ?? {})) {
      if (!(key in instance)) {
        Object.defineProperty(instance, key, {
          get() {
            return (this as any).belongsTo(key);
          },
          configurable: true,
          enumerable: false
        });
      }
    }
  }

  private static _resolveRelationship(
    constructor: typeof ActiveRecord,
    relationshipName: string,
    kind: 'hasOne' | 'hasMany' | 'belongsTo'
  ): any {
    const definitions = (constructor as any)[kind] as Record<string, any>;
    let relatedModel = definitions?.[relationshipName];

    if (!relatedModel) {
      throw new Error(`Relationship ${relationshipName} not defined in ${kind}`);
    }

    if (typeof relatedModel === 'string') {
      const resolved = constructor._modelRegistry?.get(relatedModel);
      if (!resolved) {
        throw new Error(
          `Relationship ${relationshipName} references unknown table "${relatedModel}". ` +
            `Make sure the model is registered before resolving relationships.`
        );
      }
      relatedModel = resolved;
    }

    if (!relatedModel.tableName) {
      throw new Error(`Relationship ${relationshipName} does not reference a valid ActiveRecord`);
    }

    return relatedModel;
  }

  async hasOne(relationshipName: string): Promise<any> {
    const constructor = this.constructor as typeof ActiveRecord;
    const relatedModel = ActiveRecord._resolveRelationship(constructor, relationshipName, 'hasOne');

    const singularFk = `${singularize(constructor.tableName)}Id`;
    const pluralFk = `${constructor.tableName}Id`;

    let record = await relatedModel.where(singularFk, this.id).first();
    if (!record && singularFk !== pluralFk) {
      record = await relatedModel.where(pluralFk, this.id).first();
    }
    return record;
  }

  async hasMany(relationshipName: string): Promise<any[]> {
    const constructor = this.constructor as typeof ActiveRecord;
    const relatedModel = ActiveRecord._resolveRelationship(constructor, relationshipName, 'hasMany');

    const singularFk = `${singularize(constructor.tableName)}Id`;
    const pluralFk = `${constructor.tableName}Id`;

    let records = await relatedModel.where(singularFk, this.id).all();
    if ((!records || records.length === 0) && singularFk !== pluralFk) {
      const fallbackRecords = await relatedModel.where(pluralFk, this.id).all();
      if (fallbackRecords && fallbackRecords.length > 0) {
        records = fallbackRecords;
      }
    }
    return records ?? [];
  }

  async belongsTo(relationshipName: string): Promise<any> {
    const constructor = this.constructor as typeof ActiveRecord;
    const relatedModel = ActiveRecord._resolveRelationship(constructor, relationshipName, 'belongsTo');

    const foreignKey = `${relationshipName}Id`;
    const foreignId = (this as any)[foreignKey];

    if (!foreignId) return null;
    return await relatedModel.find(foreignId);
  }

  static async beginTransaction(): Promise<IDBTransaction> {
    await this.ensureReady();
    if (!this.db) throw new Error('Database not connected');
    return this.db.transaction([this.tableName], 'readwrite');
  }

  /**
   * Introspect this model class and return a readable summary tree.
   */
  static explain(): string {
    const lines: string[] = [];
    lines.push(`ActiveRecord Model: ${this.name || 'Anonymous'}`);
    lines.push(`  Table: ${this.tableName || '(not set)'}`);
    lines.push(`  Sync Enabled: ${this.isSyncEnabled ? 'yes' : 'no'}`);
    lines.push(`  Soft Delete: ${this.isSoftDeleteEnabled ? 'yes' : 'no'}`);
    lines.push(`  Timestamps: ${this.isTimestampsEnabled ? 'yes' : 'no'}`);
    lines.push(`  Versioning: ${this.isVersioningEnabled ? 'yes' : 'no'}`);

    if (this.columns) {
      lines.push('  Columns:');
      for (const [name, def] of Object.entries(this.columns)) {
        lines.push(`    - ${name}: ${def.type ?? 'string'} (nullable: ${def.nullable ?? true})`);
      }
    }

    if (this.indexes && this.indexes.length > 0) {
      lines.push('  Indexes:');
      for (const idx of this.indexes) {
        lines.push(`    - ${idx.name || 'unnamed'}: on [${idx.keyPath}] (unique: ${Boolean(idx.unique)})`);
      }
    }

    const rels: string[] = [];
    if (this.hasMany && Object.keys(this.hasMany).length > 0) {
      rels.push(`hasMany(${Object.keys(this.hasMany).join(', ')})`);
    }
    if (this.hasOne && Object.keys(this.hasOne).length > 0) {
      rels.push(`hasOne(${Object.keys(this.hasOne).join(', ')})`);
    }
    if (this.belongsTo && Object.keys(this.belongsTo).length > 0) {
      rels.push(`belongsTo(${Object.keys(this.belongsTo).join(', ')})`);
    }
    if (rels.length > 0) {
      lines.push(`  Relationships: ${rels.join(', ')}`);
    }

    if (this.validates && Object.keys(this.validates).length > 0) {
      lines.push(`  Validations: ${Object.keys(this.validates).join(', ')}`);
    }

    return lines.join('\n');
  }
}

/**
 * Framework-agnostic live query subscription store.
 * Automatically refreshes queryFn results whenever relevant database mutations occur.
 */
export function createLiveQuery<T>(
  queryFn: () => Promise<T>,
  options: LiveQueryOptions = {}
): LiveQueryStore<T> {
  let currentSnapshot: T | undefined = options.initialValue;
  const callbacks: Set<(data: T) => void> = new Set();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounceMs = options.debounceMs ?? 50;

  async function refresh(): Promise<T> {
    try {
      const data = await queryFn();
      currentSnapshot = data;
      for (const cb of callbacks) {
        try {
          cb(data);
        } catch (err) {
          console.error('createLiveQuery callback error:', err);
        }
      }
      return data;
    } catch (err) {
      console.error('createLiveQuery query error:', err);
      throw err;
    }
  }

  function scheduleRefresh(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      refresh();
    }, debounceMs);
  }

  let unsubscribeActiveRecord: (() => void) | null = null;

  return {
    subscribe(callback: (data: T) => void): () => void {
      callbacks.add(callback);
      if (callbacks.size === 1) {
        unsubscribeActiveRecord = ActiveRecord.subscribe(() => {
          scheduleRefresh();
        });
        refresh();
      } else if (currentSnapshot !== undefined) {
        callback(currentSnapshot);
      }

      return () => {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          if (unsubscribeActiveRecord) {
            unsubscribeActiveRecord();
            unsubscribeActiveRecord = null;
          }
        }
      };
    },
    getSnapshot(): T | undefined {
      return currentSnapshot;
    },
    refresh
  };
}
