import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../src/database';
import { ActiveRecord } from '../src/activerecord';

describe('Database', () => {
  let db: Database;

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  it('should create a database instance', () => {
    db = new Database('test-db', 1);
    expect(db).toBeDefined();
    expect((db as any).name).toBe('test-db');
    expect((db as any).version).toBe(1);
  });

  it('should register a model', () => {
    db = new Database('test-db', 1);
    
    class TestModel extends ActiveRecord<any> {
      static tableName = 'test_models';
    }
    
    db.registerModel(TestModel);
    expect((db as any).models.has('test_models')).toBe(true);
  });

  it('should throw error when getting DB without connection', () => {
    db = new Database('test-db', 1);
    expect(() => db.getDB()).toThrow('Database not connected');
  });
});
