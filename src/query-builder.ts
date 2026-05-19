// QueryBuilder for chaining database queries

export class QueryBuilder<T> {
  private conditions: Array<{ field: string; operator: string; value: any }> = [];
  private orderByClause?: { field: string; direction: 'asc' | 'desc' };
  private limitValue?: number;

  constructor(
    private tableName: string,
    private db: IDBDatabase | null,
    private modelClass?: any
  ) {}

  where(field: string, operator: string, value?: any): QueryBuilder<T> {
    if (value === undefined) {
      // Handle shorthand: where('field', value) becomes where('field', '=', value)
      this.conditions.push({ field: field, operator: '=', value: operator });
    } else {
      this.conditions.push({ field, operator, value });
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

  async all(): Promise<T[]> {
    if (!this.db) throw new Error('Database not connected');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.tableName], 'readonly');
      const store = transaction.objectStore(this.tableName);
      const request = store.getAll();

      request.onsuccess = () => {
        let results = request.result;

        // Filter out soft-deleted records (check _deletedAt field on raw data)
        results = results.filter((item: any) => !item._deletedAt);

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
                return itemValue && itemValue.toString().includes(condition.value.replace('%', ''));
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

        // Apply limit
        if (this.limitValue) {
          results = results.slice(0, this.limitValue);
        }

        // Hydrate plain objects into model instances if a model class is provided
        if (this.modelClass) {
          results = results.map((item: any) => {
            const instance = Object.create(this.modelClass.prototype);
            Object.assign(instance, item);
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
    const results = await this.all();
    
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
    const results = await this.all();
    
    if (!this.db) throw new Error('Database not connected');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.tableName], 'readwrite');
      const store = transaction.objectStore(this.tableName);
      
      let completed = 0;
      const total = results.length;

      results.forEach((item: any) => {
        const request = store.delete(item.id);
        
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
