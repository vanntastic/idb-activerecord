import { describe, it, expect } from 'vitest';
import { ActiveRecord } from '../src/activerecord';

describe('ActiveRecord', () => {
  describe('setDatabase', () => {
    it('should set the database connection', () => {
      class TestModel extends ActiveRecord<any> {
        static tableName = 'test_models';
      }
      const mockDb = {} as IDBDatabase;
      TestModel.setDatabase(mockDb);
      expect((TestModel as any).db).toBe(mockDb);
    });
  });

  describe('validation', () => {
    it('should validate presence', async () => {
      class TestModel extends ActiveRecord<any> {
        static tableName = 'test_models';
        static validates = {
          name: { presence: true }
        };
      }

      const record = Object.create(TestModel.prototype);
      Object.assign(record, { name: '' });
      
      const isValid = await record.isValid();
      expect(isValid).toBe(false);
      expect(record.errors).toContain('name cannot be blank');
    });

    it('should validate length minimum', async () => {
      class TestModel extends ActiveRecord<any> {
        static tableName = 'test_models';
        static validates = {
          name: { length: { minimum: 3 } }
        };
      }

      const record = Object.create(TestModel.prototype);
      Object.assign(record, { name: 'ab' });
      
      const isValid = await record.isValid();
      expect(isValid).toBe(false);
      expect(record.errors.some((e: string) => e.includes('too short'))).toBe(true);
    });

    it('should validate format', async () => {
      class TestModel extends ActiveRecord<any> {
        static tableName = 'test_models';
        static validates = {
          email: { format: /@/ }
        };
      }

      const record = Object.create(TestModel.prototype);
      Object.assign(record, { email: 'invalid' });
      
      const isValid = await record.isValid();
      expect(isValid).toBe(false);
      expect(record.errors).toContain('email is invalid');
    });

    it('should pass valid data', async () => {
      class TestModel extends ActiveRecord<any> {
        static tableName = 'test_models';
        static validates = {
          name: { presence: true, length: { minimum: 2 } },
          email: { format: /@/ }
        };
      }

      const record = Object.create(TestModel.prototype);
      Object.assign(record, { name: 'Test', email: 'test@example.com' });
      
      const isValid = await record.isValid();
      expect(isValid).toBe(true);
      expect(record.errors.length).toBe(0);
    });

    it('should validate length maximum', async () => {
      class TestModel extends ActiveRecord<any> {
        static tableName = 'test_models';
        static validates = {
          name: { length: { maximum: 5 } }
        };
      }

      const record = Object.create(TestModel.prototype);
      Object.assign(record, { name: 'toolong' });
      
      const isValid = await record.isValid();
      expect(isValid).toBe(false);
      expect(record.errors.some((e: string) => e.includes('too long'))).toBe(true);
    });
  });

  describe('callbacks', () => {
    it('should call beforeCreate callback', async () => {
      let beforeCreateCalled = false;
      class TestModel extends ActiveRecord<any> {
        static tableName = 'test_models';
        static beforeCreate = (record: any) => {
          beforeCreateCalled = true;
          record.createdAt = new Date();
        };
      }

      const data = { name: 'Test' };
      (TestModel as any).beforeCreate?.(data);
      expect(beforeCreateCalled).toBe(true);
      expect(data.createdAt).toBeDefined();
    });

    it('should call afterCreate callback', async () => {
      let afterCreateCalled = false;
      class TestModel extends ActiveRecord<any> {
        static tableName = 'test_models';
        static afterCreate = (record: any) => {
          afterCreateCalled = true;
        };
      }

      const record = { name: 'Test' };
      (TestModel as any).afterCreate?.(record);
      expect(afterCreateCalled).toBe(true);
    });

    it('should call beforeUpdate callback', async () => {
      let beforeUpdateCalled = false;
      class TestModel extends ActiveRecord<any> {
        static tableName = 'test_models';
        static beforeUpdate = (record: any) => {
          beforeUpdateCalled = true;
        };
      }

      const record = { name: 'Test' };
      (TestModel as any).beforeUpdate?.(record);
      expect(beforeUpdateCalled).toBe(true);
    });

    it('should call afterUpdate callback', async () => {
      let afterUpdateCalled = false;
      class TestModel extends ActiveRecord<any> {
        static tableName = 'test_models';
        static afterUpdate = (record: any) => {
          afterUpdateCalled = true;
        };
      }

      const record = { name: 'Test' };
      (TestModel as any).afterUpdate?.(record);
      expect(afterUpdateCalled).toBe(true);
    });

    it('should call beforeDestroy callback', async () => {
      let beforeDestroyCalled = false;
      class TestModel extends ActiveRecord<any> {
        static tableName = 'test_models';
        static beforeDestroy = (record: any) => {
          beforeDestroyCalled = true;
        };
      }

      const record = { name: 'Test' };
      (TestModel as any).beforeDestroy?.(record);
      expect(beforeDestroyCalled).toBe(true);
    });

    it('should call afterDestroy callback', async () => {
      let afterDestroyCalled = false;
      class TestModel extends ActiveRecord<any> {
        static tableName = 'test_models';
        static afterDestroy = (record: any) => {
          afterDestroyCalled = true;
        };
      }

      const record = { name: 'Test' };
      (TestModel as any).afterDestroy?.(record);
      expect(afterDestroyCalled).toBe(true);
    });
  });
});
