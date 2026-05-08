// Base ActiveRecord class

import { QueryBuilder } from './query-builder.js';
import { ValidationRule } from './types.js';

export class ActiveRecord<T = any> {
  id?: number;
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
  errors: string[] = [];

  static setDatabase(db: IDBDatabase): void {
    this.db = db;
  }

  static async find(id: number): Promise<any> {
    if (!this.db) throw new Error('Database not connected');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.tableName], 'readonly');
      const store = transaction.objectStore(this.tableName);
      const request = store.get(id);

      request.onsuccess = () => {
        if (request.result) {
          const instance = Object.create(this.prototype);
          Object.assign(instance, request.result);
          resolve(instance);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  static async all(): Promise<any[]> {
    if (!this.db) throw new Error('Database not connected');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.tableName], 'readonly');
      const store = transaction.objectStore(this.tableName);
      const request = store.getAll();

      request.onsuccess = () => {
        const results = request.result.map((item: any) => {
          const instance = Object.create(this.prototype);
          Object.assign(instance, item);
          return instance;
        });
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  static async create(data: any): Promise<any> {
    if (!this.db) throw new Error('Database not connected');

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
        Object.assign(instance, data, { id: request.result });
        
        // Run afterCreate callback
        if (this.afterCreate) {
          this.afterCreate(instance);
        }
        
        resolve(instance);
      };
      request.onerror = () => reject(request.error);
    });
  }

  static where(field: string, operator: string, value?: any): QueryBuilder<any> {
    return new QueryBuilder<any>(this.tableName, this.db).where(field, operator, value);
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
      const request = store.put(updatedData);

      request.onsuccess = () => {
        Object.assign(this, data);
        
        // Run afterUpdate callback
        if (constructor.afterUpdate) {
          constructor.afterUpdate(this);
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

    return new Promise((resolve, reject) => {
      const transaction = constructor.db!.transaction([constructor.tableName], 'readwrite');
      const store = transaction.objectStore(constructor.tableName);
      const request = store.delete(this.id!);

      request.onsuccess = () => {
        // Run afterDestroy callback
        if (constructor.afterDestroy) {
          constructor.afterDestroy(this);
        }
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
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
