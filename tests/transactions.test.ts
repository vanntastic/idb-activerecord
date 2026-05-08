import { describe, it, expect } from 'vitest';
import { ActiveRecord } from '../src/activerecord';

describe('ActiveRecord Transactions', () => {
  describe('beginTransaction', () => {
    it('should throw error when database is not connected', async () => {
      class TestModel extends ActiveRecord<any> {
        static tableName = 'test_models';
      }

      await expect(TestModel.beginTransaction()).rejects.toThrow('Database not connected');
    });

    it('should begin a transaction when database is connected', async () => {
      class TestModel extends ActiveRecord<any> {
        static tableName = 'test_models';
      }

      const mockDb = {
        transaction: (storeNames: string[], mode: string) => ({
          objectStore: () => ({})
        } as IDBTransaction)
      } as any;

      TestModel.setDatabase(mockDb);

      const tx = await TestModel.beginTransaction();
      expect(tx).toBeDefined();
    });
  });
});
