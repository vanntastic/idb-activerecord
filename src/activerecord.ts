// Base ActiveRecord class

import { QueryBuilder } from './query-builder.js';
import { ValidationRule } from './types.js';

export class ActiveRecord<_T = any> {
  id?: string;
  _version?: number;
  _deletedAt?: string | null;
  updatedAt?: string;
  protected static db: IDBDatabase | null = null;
  protected static tableName: string = '';
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
  /**
   * Optional explicit column declarations. When set, these are the source of
   * truth for the model's schema and are used by SyncEngine to call
   * adapter.ensureTable(). Each entry can omit fields — sensible defaults
   * are applied (nullable: true, type: 'string').
   *
   * Example:
   *   static columns = {
   *     title: { type: 'string', nullable: false },
   *     priority: { type: 'integer', default: 0 }
   *   };
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

  static async find(id: string): Promise<any> {
    if (!this.db) throw new Error('Database not connected');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.tableName], 'readonly');
      const store = transaction.objectStore(this.tableName);
      const request = store.get(id);

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

  static async all(options?: { withDeleted?: boolean }): Promise<any[]> {
    if (!this.db) throw new Error('Database not connected');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.tableName], 'readonly');
      const store = transaction.objectStore(this.tableName);
      const request = store.getAll();

      request.onsuccess = () => {
        let results = request.result;
        if (!options?.withDeleted && this.softDelete) {
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

  static async withDeleted(): Promise<any[]> {
    return this.all({ withDeleted: true });
  }

  static async onlyDeleted(): Promise<any[]> {
    if (!this.db) throw new Error('Database not connected');
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.tableName], 'readonly');
      const store = transaction.objectStore(this.tableName);
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
    // Fallback for environments without crypto.randomUUID
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  static async create(data: any): Promise<any> {
    if (!this.db) throw new Error('Database not connected');

    // Generate UUID if not provided
    const id = data.id || ActiveRecord.generateUUID();
    data.id = id;

    // Auto-set timestamps and version for sync-enabled models
    if (this.enableSync) {
      data.updatedAt = data.updatedAt || new Date().toISOString();
      data._version = data._version || 1;
    }

    // Run beforeCreate callback
    if (this.beforeCreate) {
      this.beforeCreate(data);
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.tableName], 'readwrite');
      const store = transaction.objectStore(this.tableName);
      const request = store.add(data);

      request.onsuccess = () => {
        const instance = Object.create(this.prototype);
        Object.assign(instance, data);
        ActiveRecord._defineRelationshipAccessors(instance);

        // Run afterCreate callback
        if (this.afterCreate) {
          this.afterCreate(instance);
        }

        // Log change for sync tracking
        if (this.enableSync) {
          ActiveRecord.logChange(this.db!, this.tableName, id, 'create', instance);
        }

        resolve(instance);
      };
      request.onerror = () => reject(request.error);
    });
  }

  static where(field: string, operator: string, value?: any): QueryBuilder<any> {
    return new QueryBuilder<any>(this.tableName, this.db, this).where(field, operator, value);
  }

  static async transaction(callback: () => Promise<void>): Promise<void> {
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
    if (!constructor.db) throw new Error('Database not connected');

    // Run beforeUpdate callback
    if (constructor.beforeUpdate) {
      constructor.beforeUpdate(this);
    }

    return new Promise((resolve, reject) => {
      const transaction = constructor.db!.transaction([constructor.tableName], 'readwrite');
      const store = transaction.objectStore(constructor.tableName);
      const updatedData = { ...this, ...data };

      // Auto-bump version and timestamp for sync-enabled models
      if (constructor.enableSync) {
        updatedData.updatedAt = new Date().toISOString();
        updatedData._version = (updatedData._version || 0) + 1;
      }

      const request = store.put(updatedData);

      request.onsuccess = () => {
        Object.assign(this, data);
        if (constructor.enableSync) {
          Object.assign(this, { updatedAt: updatedData.updatedAt, _version: updatedData._version });
        }

        // Run afterUpdate callback
        if (constructor.afterUpdate) {
          constructor.afterUpdate(this);
        }

        // Log change for sync tracking
        if (constructor.enableSync) {
          ActiveRecord.logChange(constructor.db!, constructor.tableName, this.id!, 'update', updatedData);
        }

        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  async destroy(): Promise<void> {
    const constructor = this.constructor as typeof ActiveRecord;
    if (!constructor.db || !this.id) throw new Error('Database not connected or no ID');

    // Run beforeDestroy callback
    if (constructor.beforeDestroy) {
      constructor.beforeDestroy(this);
    }

    if (constructor.softDelete) {
      // Soft delete: set _deletedAt instead of removing
      return new Promise((resolve, reject) => {
        const transaction = constructor.db!.transaction([constructor.tableName], 'readwrite');
        const store = transaction.objectStore(constructor.tableName);
        const deletedData = { ...this, _deletedAt: new Date().toISOString() };
        if (constructor.enableSync) {
          deletedData.updatedAt = deletedData._deletedAt;
          deletedData._version = (deletedData._version || 0) + 1;
        }
        const request = store.put(deletedData);

        request.onsuccess = () => {
          Object.assign(this, { _deletedAt: deletedData._deletedAt });
          if (constructor.enableSync) {
            Object.assign(this, { updatedAt: deletedData.updatedAt, _version: deletedData._version });
          }

          if (constructor.afterDestroy) {
            constructor.afterDestroy(this);
          }

          if (constructor.enableSync) {
            ActiveRecord.logChange(constructor.db!, constructor.tableName, this.id!, 'delete', deletedData);
          }

          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    }

    // Hard delete
    return new Promise((resolve, reject) => {
      const transaction = constructor.db!.transaction([constructor.tableName], 'readwrite');
      const store = transaction.objectStore(constructor.tableName);
      const request = store.delete(this.id!);

      request.onsuccess = () => {
        if (constructor.afterDestroy) {
          constructor.afterDestroy(this);
        }

        if (constructor.enableSync) {
          ActiveRecord.logChange(constructor.db!, constructor.tableName, this.id!, 'delete', { id: this.id });
        }

        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  static async restore(id: string): Promise<void> {
    if (!this.db) throw new Error('Database not connected');
    if (!this.softDelete) throw new Error('softDelete is not enabled');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.tableName], 'readwrite');
      const store = transaction.objectStore(this.tableName);
      const request = store.get(id);

      request.onsuccess = () => {
        const record = request.result;
        if (!record) return reject(new Error('Record not found'));
        if (!record._deletedAt) return reject(new Error('Record is not deleted'));

        const restored = { ...record, _deletedAt: null };
        if (this.enableSync) {
          restored.updatedAt = new Date().toISOString();
          restored._version = (restored._version || 0) + 1;
        }

        const putReq = store.put(restored);
        putReq.onsuccess = () => {
          if (this.enableSync) {
            ActiveRecord.logChange(this.db!, this.tableName, id, 'update', restored);
          }
          resolve();
        };
        putReq.onerror = () => reject(putReq.error);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Optional listener invoked after a change is logged. Used by Database to
   * trigger auto-sync. Set via ActiveRecord.setChangeListener().
   */
  private static changeListener: ((table: string) => void) | null = null;

  static setChangeListener(listener: ((table: string) => void) | null): void {
    ActiveRecord.changeListener = listener;
  }

  /**
   * Log a sync change to the __sync_changes store
   */
  private static logChange(
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
          try { ActiveRecord.changeListener(table); } catch { /* ignore listener errors */ }
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

  private static _defineRelationshipAccessors(instance: any): void {
    const constructor = instance.constructor as typeof ActiveRecord;
    for (const key of Object.keys(constructor.hasOne ?? {})) {
      if (!(key in instance)) {
        Object.defineProperty(instance, key, {
          get() { return (this as any).hasOne(key); },
          configurable: true,
          enumerable: false
        });
      }
    }
    for (const key of Object.keys(constructor.hasMany ?? {})) {
      if (!(key in instance)) {
        Object.defineProperty(instance, key, {
          get() { return (this as any).hasMany(key); },
          configurable: true,
          enumerable: false
        });
      }
    }
    for (const key of Object.keys(constructor.belongsTo ?? {})) {
      if (!(key in instance)) {
        Object.defineProperty(instance, key, {
          get() { return (this as any).belongsTo(key); },
          configurable: true,
          enumerable: false
        });
      }
    }
  }

  // Relationship methods
  async hasOne(relationshipName: string): Promise<any> {
    const constructor = this.constructor as typeof ActiveRecord;
    const relatedModel = constructor.hasOne?.[relationshipName];
    
    if (!relatedModel) {
      throw new Error(`Relationship ${relationshipName} not defined in hasOne`);
    }

    const foreignKey = `${constructor.tableName}Id`;
    return await relatedModel.where(foreignKey, this.id).first();
  }

  async hasMany(relationshipName: string): Promise<any[]> {
    const constructor = this.constructor as typeof ActiveRecord;
    const relatedModel = constructor.hasMany?.[relationshipName];
    
    if (!relatedModel) {
      throw new Error(`Relationship ${relationshipName} not defined in hasMany`);
    }

    const foreignKey = `${constructor.tableName}Id`;
    return await relatedModel.where(foreignKey, this.id).all();
  }

  async belongsTo(relationshipName: string): Promise<any> {
    const constructor = this.constructor as typeof ActiveRecord;
    const relatedModel = constructor.belongsTo?.[relationshipName];
    
    if (!relatedModel) {
      throw new Error(`Relationship ${relationshipName} not defined in belongsTo`);
    }

    const foreignKey = `${relationshipName}Id`;
    const foreignId = (this as any)[foreignKey];
    
    if (!foreignId) return null;
    
    return await relatedModel.find(foreignId);
  }

  static async beginTransaction(): Promise<IDBTransaction> {
    if (!this.db) throw new Error('Database not connected');
    return this.db.transaction([this.tableName], 'readwrite');
  }
}
