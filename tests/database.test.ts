import { describe, it, expect, afterEach, vi } from 'vitest';
import { Database } from '../src/database';
import { ActiveRecord } from '../src/activerecord';
import {
  BaseAdapter,
  AdapterConfig,
  SyncQuery,
  PushOptions,
  SyncResult,
  TableSchema,
  SyncMigration,
  SyncStatus,
  ColumnDef
} from '../src/sync-adapter';
import { MockIDBDatabase } from './mocks/indexeddb';

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

  describe('user context', () => {
    it('setUser stores the user id', () => {
      db = new Database('test-db');
      db.setUser('alice');
      expect(db.getUser()).toBe('alice');
    });

    it('setUser propagates to existing SyncEngine', () => {
      db = new Database('test-db');
      // Manually inject an engine to test propagation
      const engine = { setUser: vi.fn(), setDatabase: vi.fn() } as any;
      (db as any).engine = engine;
      db.setUser('bob');
      expect(engine.setUser).toHaveBeenCalledWith('bob');
    });

    it('SyncEngine inherits user when first created', () => {
      db = new Database('test-db');
      db.setUser('charlie');
      const mockDb = new MockIDBDatabase('test-db', 1) as unknown as IDBDatabase;
      (db as any).db = mockDb;
      const engine = db.getSyncEngine();
      expect(engine.getUser()).toBe('charlie');
    });
  });

  describe('enableAutoSync', () => {
    class SpyAdapter extends BaseAdapter {
      pullCalls: SyncQuery[] = [];
      pushCalls: any[][] = [];
      ensureCalls: { table: string; columns?: ColumnDef[] }[] = [];
      async connect(config: AdapterConfig): Promise<void> {
        this.config = config;
        this.connected = true;
        this.updateState({ status: SyncStatus.IDLE });
      }
      async disconnect(): Promise<void> { this.connected = false; }
      async pull<T extends ActiveRecord>(query: SyncQuery): Promise<T[]> {
        this.pullCalls.push(query);
        return [] as T[];
      }
      async push<T extends ActiveRecord>(records: T[]): Promise<SyncResult> {
        this.pushCalls.push(records);
        return { pushed: records.length, pulled: 0, conflicts: 0, errors: [], timestamp: new Date() };
      }
      async getRemoteSchema(table: string): Promise<TableSchema> {
        return { name: table, columns: [], indexes: [] };
      }
      async applyMigration(_m: SyncMigration): Promise<void> {}
      async ensureTable(table: string, columns?: ColumnDef[]): Promise<void> {
        this.ensureCalls.push({ table, columns });
      }
    }

    function makeDbWithSyncStores(): { db: Database; mockDb: IDBDatabase } {
      const database = new Database('autosync-db');
      const mockDb = new MockIDBDatabase('autosync-db', 1) as unknown as IDBDatabase;
      (mockDb as any).createObjectStore('__sync_meta', { keyPath: 'table' });
      const cs = (mockDb as any).createObjectStore('__sync_changes', { keyPath: 'id', autoIncrement: true });
      cs.createIndex('table', 'table', { unique: false });
      cs.createIndex('synced', 'synced', { unique: false });
      (mockDb as any).createObjectStore('tasks', { keyPath: 'id', autoIncrement: true });
      (database as any).db = mockDb;
      return { db: database, mockDb };
    }

    it('triggers a debounced sync after a change on a sync-enabled model', async () => {
      const { db: database, mockDb } = makeDbWithSyncStores();
      class Task extends ActiveRecord<any> {
        static tableName = 'tasks';
        static enableSync = true;
      }
      Task.setDatabase(mockDb);
      database.registerModel(Task);

      const adapter = new SpyAdapter();
      await adapter.connect({ url: 'http://test' });
      database.enableAutoSync(adapter, { debounceMs: 5 });

      await Task.create({ title: 'Hello', owner_id: 'alice' });

      // Wait for change tx commit (5ms) + debounce (5ms) + idle callback + sync
      await new Promise(r => setTimeout(r, 100));

      expect(adapter.pushCalls.length).toBeGreaterThanOrEqual(1);
      expect(adapter.pullCalls.length).toBeGreaterThanOrEqual(1);
      database.disableAutoSync();
    });

    it('does not trigger sync for models without enableSync', async () => {
      const { db: database, mockDb } = makeDbWithSyncStores();
      class LocalOnly extends ActiveRecord<any> {
        static tableName = 'tasks';
        // No enableSync flag — defaults to false
      }
      LocalOnly.setDatabase(mockDb);
      database.registerModel(LocalOnly);

      const adapter = new SpyAdapter();
      await adapter.connect({ url: 'http://test' });
      database.enableAutoSync(adapter, { debounceMs: 5 });

      await LocalOnly.create({ title: 'Local', owner_id: 'alice' });
      await new Promise(r => setTimeout(r, 50));

      expect(adapter.pushCalls).toHaveLength(0);
      expect(adapter.pullCalls).toHaveLength(0);
      database.disableAutoSync();
    });

    it('disableAutoSync stops further auto-sync triggers', async () => {
      const { db: database, mockDb } = makeDbWithSyncStores();
      class Task extends ActiveRecord<any> {
        static tableName = 'tasks';
        static enableSync = true;
      }
      Task.setDatabase(mockDb);
      database.registerModel(Task);

      const adapter = new SpyAdapter();
      await adapter.connect({ url: 'http://test' });
      database.enableAutoSync(adapter, { debounceMs: 5 });
      database.disableAutoSync();

      await Task.create({ title: 'After disable', owner_id: 'alice' });
      await new Promise(r => setTimeout(r, 50));

      expect(adapter.pushCalls).toHaveLength(0);
    });

    it('does not run when adapter is not connected', async () => {
      const { db: database, mockDb } = makeDbWithSyncStores();
      class Task extends ActiveRecord<any> {
        static tableName = 'tasks';
        static enableSync = true;
      }
      Task.setDatabase(mockDb);
      database.registerModel(Task);

      const adapter = new SpyAdapter();
      // Intentionally not connected
      database.enableAutoSync(adapter, { debounceMs: 5 });

      await Task.create({ title: 'Disconnected', owner_id: 'alice' });
      await new Promise(r => setTimeout(r, 50));

      expect(adapter.pushCalls).toHaveLength(0);
      database.disableAutoSync();
    });
  });
});
