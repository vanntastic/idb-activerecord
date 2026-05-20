import { describe, it, expect } from 'vitest';
import { QueryBuilder } from '../src/query-builder';
import { ActiveRecord } from '../src/activerecord';
import { MockIDBDatabase } from './mocks/indexeddb';

describe('QueryBuilder', () => {
  describe('where', () => {
    it('should add a condition', () => {
      const qb = new QueryBuilder<any>('test', null);
      const result = qb.where('name', '=', 'John');
      expect(result).toBe(qb);
      expect((qb as any).conditions).toHaveLength(1);
    });

    it('should support shorthand syntax', () => {
      const qb = new QueryBuilder<any>('test', null);
      qb.where('name', 'John');
      expect((qb as any).conditions[0]).toEqual({ field: 'name', operator: '=', value: 'John' });
    });

    it('should chain multiple where conditions', () => {
      const qb = new QueryBuilder<any>('test', null);
      qb.where('age', '>', 18).where('name', 'John');
      expect((qb as any).conditions).toHaveLength(2);
    });
  });

  describe('orderBy', () => {
    it('should add order clause', () => {
      const qb = new QueryBuilder<any>('test', null);
      const result = qb.orderBy('name', 'asc');
      expect(result).toBe(qb);
      expect((qb as any).orderByClause).toEqual({ field: 'name', direction: 'asc' });
    });

    it('should default to ascending order', () => {
      const qb = new QueryBuilder<any>('test', null);
      qb.orderBy('name');
      expect((qb as any).orderByClause).toEqual({ field: 'name', direction: 'asc' });
    });
  });

  describe('limit', () => {
    it('should add limit clause', () => {
      const qb = new QueryBuilder<any>('test', null);
      const result = qb.limit(10);
      expect(result).toBe(qb);
      expect((qb as any).limitValue).toBe(10);
    });
  });

  describe('chaining', () => {
    it('should support method chaining', () => {
      const qb = new QueryBuilder<any>('test', null);
      const result = qb.where('age', '>', 18).orderBy('name').limit(10);
      expect(result).toBe(qb);
      expect((qb as any).conditions).toHaveLength(1);
      expect((qb as any).orderByClause).toBeDefined();
      expect((qb as any).limitValue).toBe(10);
    });
  });

  describe('hydration', () => {
    class Task extends ActiveRecord<any> {
      static tableName = 'tasks';
      customMethod(): string { return 'hydrated'; }
    }

    function setupDb(): IDBDatabase {
      const db = new MockIDBDatabase('test', 1) as unknown as IDBDatabase;
      (db as any).createObjectStore('tasks', { keyPath: 'id', autoIncrement: true });
      const tx = db.transaction(['tasks'], 'readwrite');
      const store = tx.objectStore('tasks');
      store.add({ id: 1, title: 'A', owner_id: 'alice' });
      store.add({ id: 2, title: 'B', owner_id: 'alice' });
      store.add({ id: 3, title: 'C', owner_id: 'bob' });
      return db;
    }

    it('returns plain objects when no modelClass provided', async () => {
      const db = setupDb();
      const qb = new QueryBuilder<any>('tasks', db);
      const results = await qb.where('owner_id', '=', 'alice').all();
      expect(results).toHaveLength(2);
      // No model class, no instance methods
      expect((results[0] as any).customMethod).toBeUndefined();
    });

    it('hydrates results into model instances when modelClass provided', async () => {
      const db = setupDb();
      const qb = new QueryBuilder<any>('tasks', db, Task);
      const results = await qb.where('owner_id', '=', 'alice').all();
      expect(results).toHaveLength(2);
      // All results should be instances of Task with the customMethod
      for (const r of results) {
        expect(r).toBeInstanceOf(Task);
        expect((r as any).customMethod()).toBe('hydrated');
      }
    });

    it('static where() passes model class to QueryBuilder', async () => {
      const db = setupDb();
      Task.setDatabase(db);
      const qb = Task.where('owner_id', '=', 'alice');
      expect((qb as any).modelClass).toBe(Task);
    });
  });
});
