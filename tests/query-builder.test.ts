import { describe, it, expect } from 'vitest';
import { QueryBuilder } from '../src/query-builder';

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
});
