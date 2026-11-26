// QueryBuilder for chaining database queries with strict generic typing
// and pluggable StorageAdapter support.

import { StorageAdapter } from './storage-adapter.js';

export class QueryBuilder<T> {
  private conditions: Array<{ field: string; operator: string; value: any }> = [];
  private orderByClause?: { field: string; direction: 'asc' | 'desc' };
  private limitValue?: number;
  private offsetValue?: number;

  constructor(
    private tableName: string,
    private db: IDBDatabase | null,
    private modelClass?: any,
    private storage?: StorageAdapter | null
  ) {}

  where(field: string, operator: string, value?: any): QueryBuilder<T>;
  where(field: string, value: any): QueryBuilder<T>;
  where(field: string, operatorOrValue: any, value?: any): QueryBuilder<T> {
    if (value === undefined) {
      // Handle shorthand: where('field', value) becomes where('field', '=', value)
      this.conditions.push({ field: field, operator: '=', value: operatorOrValue });
    } else {
      this.conditions.push({ field, operator: operatorOrValue, value });
    }
    return this;
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): QueryBuilder<T> {
    this.orderByClause = { field, direction };
    return this;
  }

  limit(count: number): QueryBuilder<T> {
    this.limitValue = count;
    return this;
  }

  offset(count: number): QueryBuilder<T> {
    this.offsetValue = count;
    return this;
  }

  private async ensureConnection(): Promise<void> {
    if (!this.storage && !this.db && this.modelClass?.ensureReady) {
      await this.modelClass.ensureReady();
      if (!this.storage && this.modelClass.getStorage) {
        this.storage = this.modelClass.getStorage();
      }
      if (!this.db && this.modelClass.getDatabase) {
        this.db = this.modelClass.getDatabase();
      }
    }
  }

  async all(): Promise<T[]> {
    await this.ensureConnection();

    if (this.storage) {
      const isSoftDelete = this.modelClass?.isSoftDeleteEnabled ?? true;
      const rows = await this.storage.getAll(this.tableName, {
        where: this.conditions,
        orderBy: this.orderByClause,
        limit: this.limitValue,
        offset: this.offsetValue,
        includeDeleted: !isSoftDelete
      });

      if (this.modelClass) {
        return rows.map((item: any) => {
          const instance = Object.create(this.modelClass.prototype);
          Object.assign(instance, item);
          if (typeof this.modelClass._defineRelationshipAccessors === 'function') {
            this.modelClass._defineRelationshipAccessors(instance);
          }
          return instance as T;
        });
      }
      return rows as T[];
    }

    if (!this.db) throw new Error('Database not connected');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.tableName], 'readonly');
      const store = transaction.objectStore(this.tableName);
      const request = store.getAll();

      request.onsuccess = () => {
        let results = request.result;

        // Filter out soft-deleted records (check _deletedAt field on raw data)
        const isSoftDelete = this.modelClass?.isSoftDeleteEnabled ?? true;
        if (isSoftDelete) {
          results = results.filter((item: any) => !item._deletedAt);
        }

        // Apply conditions
        results = results.filter((item: any) => {
          return this.conditions.every(condition => {
            const itemValue = item[condition.field];
            switch (condition.operator) {
              case '=':
                return itemValue === condition.value;
              case '!=':
                return itemValue !== condition.value;
              case '>':
                return itemValue > condition.value;
              case '>=':
                return itemValue >= condition.value;
              case '<':
                return itemValue < condition.value;
              case '<=':
                return itemValue <= condition.value;
              case 'like':
                return itemValue && itemValue.toString().includes(condition.value.replace(/%/g, ''));
              default:
                return true;
            }
          });
        });

        // Apply ordering
        if (this.orderByClause) {
          results.sort((a: any, b: any) => {
            const aVal = a[this.orderByClause!.field];
            const bVal = b[this.orderByClause!.field];
            const comparison = aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
            return this.orderByClause!.direction === 'desc' ? -comparison : comparison;
          });
        }

        // Apply offset
        if (this.offsetValue) {
          results = results.slice(this.offsetValue);
        }

        // Apply limit
        if (this.limitValue) {
          results = results.slice(0, this.limitValue);
        }

        // Hydrate plain objects into model instances if a model class is provided
        if (this.modelClass) {
          results = results.map((item: any) => {
            const instance = Object.create(this.modelClass.prototype);
            Object.assign(instance, item);
            if (typeof this.modelClass._defineRelationshipAccessors === 'function') {
              this.modelClass._defineRelationshipAccessors(instance);
            }
            return instance;
          });
        }

        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async first(): Promise<T | null> {
    const results = await this.limit(1).all();
    return results.length > 0 ? results[0] : null;
  }

  async count(): Promise<number> {
    const results = await this.all();
    return results.length;
  }

  async exists(): Promise<boolean> {
    const result = await this.first();
    return result !== null;
  }

  async update(data: any): Promise<void> {
    await this.ensureConnection();
    const results = await this.all();

    if (this.storage) {
      for (const item of results) {
        await this.storage.put(this.tableName, { ...item, ...data });
      }
      return;
    }

    if (!this.db) throw new Error('Database not connected');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.tableName], 'readwrite');
      const store = transaction.objectStore(this.tableName);

      let completed = 0;
      const total = results.length;

      results.forEach((item: any) => {
        const updatedData = { ...item, ...data };
        const request = store.put(updatedData);

        request.onsuccess = () => {
          completed++;
          if (completed === total) resolve();
        };
        request.onerror = () => reject(request.error);
      });

      if (total === 0) resolve();
    });
  }

  async destroyAll(): Promise<void> {
    await this.ensureConnection();
    const results = await this.all();

    if (this.storage) {
      const isSoftDelete = this.modelClass?.isSoftDeleteEnabled ?? false;
      for (const item of results as any[]) {
        if (isSoftDelete) {
          await this.storage.put(this.tableName, {
            ...item,
            _deletedAt: new Date().toISOString()
          });
        } else {
          await this.storage.delete(this.tableName, item.id);
        }
      }
      return;
    }

    if (!this.db) throw new Error('Database not connected');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.tableName], 'readwrite');
      const store = transaction.objectStore(this.tableName);

      let completed = 0;
      const total = results.length;

      results.forEach((item: any) => {
        const isSoftDelete = this.modelClass?.isSoftDeleteEnabled ?? false;
        const request = isSoftDelete
          ? store.put({ ...item, _deletedAt: new Date().toISOString() })
          : store.delete(item.id);

        request.onsuccess = () => {
          completed++;
          if (completed === total) resolve();
        };
        request.onerror = () => reject(request.error);
      });

      if (total === 0) resolve();
    });
  }
}
