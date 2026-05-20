import { describe, it, expect } from 'vitest';
import { SyncEngine } from '../src/sync-engine';
import {
  BaseAdapter,
  AdapterConfig,
  SyncQuery,
  PushOptions,
  SyncResult,
  TableSchema,
  SyncMigration,
  ConflictStrategy,
  SyncStatus
} from '../src/sync-adapter';
import { ActiveRecord } from '../src/activerecord';
import { MockIDBDatabase } from './mocks/indexeddb';

class TestAdapter extends BaseAdapter {
  private remoteData: any[] = [];

  async connect(config: AdapterConfig): Promise<void> {
    this.config = config;
    this.connected = true;
    this.updateState({ status: SyncStatus.IDLE });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async pull<T extends ActiveRecord>(query: SyncQuery): Promise<T[]> {
    this.updateState({ status: SyncStatus.SYNCING });
    const since = query.since;
    const results = this.remoteData.filter(r => {
      if (!since) return true;
      return new Date(r.updatedAt) > since;
    });
    this.updateState({ lastPullAt: new Date(), status: SyncStatus.IDLE });
    return results as T[];
  }

  async push<T extends ActiveRecord>(records: T[], options?: PushOptions): Promise<SyncResult> {
    this.updateState({ status: SyncStatus.SYNCING });
    for (const rec of records) {
      const idx = this.remoteData.findIndex(r => r.id === (rec as any).id);
      if (idx >= 0) {
        this.remoteData[idx] = rec;
      } else {
        this.remoteData.push(rec);
      }
    }
    this.updateState({ lastPushAt: new Date(), status: SyncStatus.IDLE });
    return {
      pushed: records.length,
      pulled: 0,
      conflicts: 0,
      errors: [],
      timestamp: new Date()
    };
  }

  async getRemoteSchema(table: string): Promise<TableSchema> {
    return { name: table, columns: [], indexes: [] };
  }

  async applyMigration(migration: SyncMigration): Promise<void> {}

  setRemoteData(data: any[]): void {
    this.remoteData = data;
  }
}

function createMockDB(): IDBDatabase {
  const mockDb = new MockIDBDatabase('test', 2) as unknown as IDBDatabase;

  // Create stores manually (bypassing async upgrade flow)
  (mockDb as any).createObjectStore('__sync_meta', { keyPath: 'table' });
  const changeStore = (mockDb as any).createObjectStore('__sync_changes', {
    keyPath: 'id',
    autoIncrement: true
  });
  changeStore.createIndex('table', 'table', { unique: false });
  changeStore.createIndex('synced', 'synced', { unique: false });
  (mockDb as any).createObjectStore('tasks', { keyPath: 'id', autoIncrement: true });

  return mockDb;
}

describe('SyncEngine', () => {
  it('should track sync metadata', async () => {
    const engine = new SyncEngine();
    engine.setDatabase(createMockDB());

    const adapter = new TestAdapter();
    await adapter.connect({ url: 'http://test' });

    const result = await engine.sync('tasks', adapter);

    expect(result.pushed).toBe(0);
    expect(result.pulled).toBe(0);
  });

  it('should push local changes to remote', async () => {
    const mockDb = createMockDB();
    const engine = new SyncEngine();
    engine.setDatabase(mockDb);

    const adapter = new TestAdapter();
    await adapter.connect({ url: 'http://test' });

    // Simulate a logged change
    const tx = mockDb.transaction(['__sync_changes'], 'readwrite');
    const store = tx.objectStore('__sync_changes');
    store.add({
      table: 'tasks',
      recordId: 1,
      action: 'create',
      data: { id: 1, title: 'Test', updatedAt: new Date().toISOString(), _version: 1 },
      timestamp: new Date().toISOString(),
      synced: false
    });

    // Wait for add to complete (mock is sync)
    await new Promise(r => setTimeout(r, 10));

    const pending = await engine.getPendingCount('tasks');
    expect(pending).toBe(1);

    const result = await engine.pushChanges('tasks', adapter);
    expect(result.pushed).toBe(1);

    const afterPush = await engine.getPendingCount('tasks');
    expect(afterPush).toBe(0);
  });

  it('should pull remote changes', async () => {
    const engine = new SyncEngine();
    engine.setDatabase(createMockDB());

    const adapter = new TestAdapter();
    await adapter.connect({ url: 'http://test' });
    adapter.setRemoteData([
      { id: 1, title: 'Remote Task', updatedAt: new Date().toISOString(), _version: 1 }
    ]);

    const remote = await engine.pullChanges('tasks', adapter);
    expect(remote.length).toBe(1);
    expect(remote[0].title).toBe('Remote Task');
  });

  it('should merge remote changes into local database', async () => {
    const mockDb = createMockDB();
    const engine = new SyncEngine();
    engine.setDatabase(mockDb);

    const adapter = new TestAdapter();
    await adapter.connect({ url: 'http://test' });

    const remote = [
      { id: 1, title: 'Remote Task', updatedAt: new Date().toISOString(), _version: 1 }
    ];

    const result = await engine.mergeChanges('tasks', remote, adapter, ConflictStrategy.LAST_WRITE_WINS);
    expect(result.pulled).toBe(0);
    expect(result.conflicts).toBe(0);

    // Verify local store has the record
    const tx = mockDb.transaction(['tasks'], 'readonly');
    const store = tx.objectStore('tasks');
    const req = store.get(1);
    await new Promise(r => setTimeout(r, 10));
    expect(req.result).toBeDefined();
    expect(req.result.title).toBe('Remote Task');
  });

  it('should resolve version conflicts during merge', async () => {
    const mockDb = createMockDB();
    const engine = new SyncEngine();
    engine.setDatabase(mockDb);

    const adapter = new TestAdapter();
    await adapter.connect({ url: 'http://test' });

    // Pre-seed local record with lower version
    const tx = mockDb.transaction(['tasks'], 'readwrite');
    const store = tx.objectStore('tasks');
    store.add({ id: 1, title: 'Local', updatedAt: '2024-01-01T00:00:00Z', _version: 1 });
    await new Promise(r => setTimeout(r, 10));

    // Remote has higher version
    const remote = [
      { id: 1, title: 'Remote', updatedAt: '2024-02-01T00:00:00Z', _version: 2 }
    ];

    await engine.mergeChanges('tasks', remote, adapter, ConflictStrategy.LAST_WRITE_WINS);

    const tx2 = mockDb.transaction(['tasks'], 'readonly');
    const store2 = tx2.objectStore('tasks');
    const req = store2.get(1);
    await new Promise(r => setTimeout(r, 10));
    expect(req.result.title).toBe('Remote');
  });

  it('should prefer local when local version is higher', async () => {
    const mockDb = createMockDB();
    const engine = new SyncEngine();
    engine.setDatabase(mockDb);

    const adapter = new TestAdapter();
    await adapter.connect({ url: 'http://test' });

    // Pre-seed local record with higher version
    const tx = mockDb.transaction(['tasks'], 'readwrite');
    const store = tx.objectStore('tasks');
    store.put({ id: 1, title: 'Local', updatedAt: '2024-02-01T00:00:00Z', _version: 3 });
    await new Promise(r => setTimeout(r, 10));

    // Remote has lower version
    const remote = [
      { id: 1, title: 'Remote', updatedAt: '2024-01-01T00:00:00Z', _version: 2 }
    ];

    await engine.mergeChanges('tasks', remote, adapter, ConflictStrategy.LAST_WRITE_WINS);

    const tx2 = mockDb.transaction(['tasks'], 'readonly');
    const store2 = tx2.objectStore('tasks');
    const req = store2.get(1);
    await new Promise(r => setTimeout(r, 10));
    expect(req.result.title).toBe('Local');
  });

  it('should apply soft deletes from remote', async () => {
    const mockDb = createMockDB();
    const engine = new SyncEngine();
    engine.setDatabase(mockDb);

    const adapter = new TestAdapter();
    await adapter.connect({ url: 'http://test' });

    // Pre-seed local record
    const tx = mockDb.transaction(['tasks'], 'readwrite');
    const store = tx.objectStore('tasks');
    store.add({ id: 1, title: 'To Delete', updatedAt: '2024-01-01T00:00:00Z', _version: 1 });
    await new Promise(r => setTimeout(r, 10));

    // Remote tombstone
    const remote = [
      { id: 1, title: 'To Delete', updatedAt: '2024-02-01T00:00:00Z', _version: 2, _deletedAt: '2024-02-01T00:00:00Z' }
    ];

    await engine.mergeChanges('tasks', remote, adapter, ConflictStrategy.LAST_WRITE_WINS);

    const tx2 = mockDb.transaction(['tasks'], 'readonly');
    const store2 = tx2.objectStore('tasks');
    const req = store2.get(1);
    await new Promise(r => setTimeout(r, 10));
    expect(req.result._deletedAt).toBeDefined();
  });

  describe('user context', () => {
    it('setUser stores the user id', () => {
      const engine = new SyncEngine();
      engine.setUser('alice');
      expect(engine.getUser()).toBe('alice');
    });

    it('pullChanges filters by owner_id when user is set', async () => {
      const engine = new SyncEngine();
      engine.setDatabase(createMockDB());
      engine.setUser('alice');

      let capturedQuery: SyncQuery | null = null;
      const adapter = new TestAdapter();
      await adapter.connect({ url: 'http://test' });
      // Spy on pull to capture the query
      const origPull = adapter.pull.bind(adapter);
      adapter.pull = async (q: SyncQuery) => {
        capturedQuery = q;
        return origPull(q);
      };

      await engine.pullChanges('tasks', adapter);
      expect(capturedQuery).not.toBeNull();
      expect(capturedQuery!.where).toEqual({ owner_id: 'alice' });
    });

    it('pullChanges does not filter by owner_id when user is unset', async () => {
      const engine = new SyncEngine();
      engine.setDatabase(createMockDB());

      let capturedQuery: SyncQuery | null = null;
      const adapter = new TestAdapter();
      await adapter.connect({ url: 'http://test' });
      const origPull = adapter.pull.bind(adapter);
      adapter.pull = async (q: SyncQuery) => {
        capturedQuery = q;
        return origPull(q);
      };

      await engine.pullChanges('tasks', adapter);
      expect(capturedQuery!.where).toBeUndefined();
    });

    it('pullChanges always sets includeDeleted: true so tombstones propagate', async () => {
      const engine = new SyncEngine();
      engine.setDatabase(createMockDB());

      let capturedQuery: SyncQuery | null = null;
      const adapter = new TestAdapter();
      await adapter.connect({ url: 'http://test' });
      const origPull = adapter.pull.bind(adapter);
      adapter.pull = async (q: SyncQuery) => {
        capturedQuery = q;
        return origPull(q);
      };

      await engine.pullChanges('tasks', adapter);
      expect(capturedQuery!.includeDeleted).toBe(true);
    });
  });

  describe('schema (ensureTable)', () => {
    it('passes sync meta columns + derived user columns to ensureTable', async () => {
      const mockDb = createMockDB();
      const engine = new SyncEngine();
      engine.setDatabase(mockDb);

      // Seed a pending change so derivedColumns has something to work with
      const tx = mockDb.transaction(['__sync_changes'], 'readwrite');
      tx.objectStore('__sync_changes').add({
        table: 'tasks',
        recordId: 1,
        action: 'create',
        data: { id: 1, title: 'Hello', status: 'pending', owner_id: 'alice', updatedAt: new Date().toISOString(), _version: 1 },
        timestamp: new Date().toISOString(),
        synced: false
      });
      await new Promise(r => setTimeout(r, 10));

      let capturedColumns: any[] | undefined;
      const adapter = new TestAdapter();
      await adapter.connect({ url: 'http://test' });
      const origEnsure = adapter.ensureTable.bind(adapter);
      adapter.ensureTable = async (table: string, columns?: any[]) => {
        capturedColumns = columns;
        return origEnsure(table, columns);
      };

      await engine.sync('tasks', adapter);

      const names = capturedColumns!.map(c => c.name);
      // Sync meta columns must be present
      for (const meta of ['id', 'updatedAt', 'version', 'deleted_at', 'owner_id']) {
        expect(names).toContain(meta);
      }
      // Derived user columns from the pending record (excluding meta fields)
      expect(names).toContain('title');
      expect(names).toContain('status');
      // Sync meta wire fields (_version, _deletedAt) must NOT leak as columns
      expect(names).not.toContain('_version');
      expect(names).not.toContain('_deletedAt');

      const idCol = capturedColumns!.find(c => c.name === 'id');
      expect(idCol.primaryKey).toBe(true);
      expect(idCol.autoIncrement).toBe(true);
    });

    it('declared SyncOptions.columns is strict: inferred columns are excluded', async () => {
      const mockDb = createMockDB();
      const engine = new SyncEngine();
      engine.setDatabase(mockDb);

      // Pending record has an `extra` field that is NOT declared
      const tx = mockDb.transaction(['__sync_changes'], 'readwrite');
      tx.objectStore('__sync_changes').add({
        table: 'tasks',
        recordId: 1,
        action: 'create',
        data: { id: 1, title: 'Hello', extra: 42, updatedAt: new Date().toISOString(), _version: 1 },
        timestamp: new Date().toISOString(),
        synced: false
      });
      await new Promise(r => setTimeout(r, 10));

      let capturedColumns: any[] | undefined;
      const adapter = new TestAdapter();
      await adapter.connect({ url: 'http://test' });
      const origEnsure = adapter.ensureTable.bind(adapter);
      adapter.ensureTable = async (table: string, columns?: any[]) => {
        capturedColumns = columns;
        return origEnsure(table, columns);
      };

      await engine.sync('tasks', adapter, {
        columns: [
          { name: 'title', type: 'string', nullable: false, default: 'untitled' }
        ]
      });

      const title = capturedColumns!.find(c => c.name === 'title');
      expect(title.nullable).toBe(false);
      expect(title.default).toBe('untitled');

      // `extra` was inferred-only — it must NOT appear when declared columns are present
      expect(capturedColumns!.find(c => c.name === 'extra')).toBeUndefined();
    });

    it('falls back to inference when no columns are declared', async () => {
      const mockDb = createMockDB();
      const engine = new SyncEngine();
      engine.setDatabase(mockDb);

      const tx = mockDb.transaction(['__sync_changes'], 'readwrite');
      tx.objectStore('__sync_changes').add({
        table: 'tasks',
        recordId: 1,
        action: 'create',
        data: { id: 1, title: 'Hello', extra: 42, updatedAt: new Date().toISOString(), _version: 1 },
        timestamp: new Date().toISOString(),
        synced: false
      });
      await new Promise(r => setTimeout(r, 10));

      let capturedColumns: any[] | undefined;
      const adapter = new TestAdapter();
      await adapter.connect({ url: 'http://test' });
      const origEnsure = adapter.ensureTable.bind(adapter);
      adapter.ensureTable = async (table: string, columns?: any[]) => {
        capturedColumns = columns;
        return origEnsure(table, columns);
      };

      // No options.columns — should infer
      await engine.sync('tasks', adapter);

      expect(capturedColumns!.find(c => c.name === 'title')).toBeDefined();
      expect(capturedColumns!.find(c => c.name === 'extra')).toBeDefined();
    });

    it('infers integer type for numeric fields and string for text', async () => {
      const mockDb = createMockDB();
      const engine = new SyncEngine();
      engine.setDatabase(mockDb);

      const tx = mockDb.transaction(['__sync_changes'], 'readwrite');
      tx.objectStore('__sync_changes').add({
        table: 'tasks',
        recordId: 1,
        action: 'create',
        data: { id: 1, title: 'Hello', priority: 5, done: true, updatedAt: new Date().toISOString(), _version: 1 },
        timestamp: new Date().toISOString(),
        synced: false
      });
      await new Promise(r => setTimeout(r, 10));

      let capturedColumns: any[] | undefined;
      const adapter = new TestAdapter();
      await adapter.connect({ url: 'http://test' });
      const origEnsure = adapter.ensureTable.bind(adapter);
      adapter.ensureTable = async (table: string, columns?: any[]) => {
        capturedColumns = columns;
        return origEnsure(table, columns);
      };

      await engine.sync('tasks', adapter);

      const byName = (n: string) => capturedColumns!.find(c => c.name === n);
      expect(byName('title').type).toBe('string');
      expect(byName('priority').type).toBe('integer');
      expect(byName('done').type).toBe('boolean');
    });
  });

  it('should clear sync data', async () => {
    const mockDb = createMockDB();
    const engine = new SyncEngine();
    engine.setDatabase(mockDb);

    // Seed some sync data
    const tx = mockDb.transaction(['__sync_changes', '__sync_meta'], 'readwrite');
    tx.objectStore('__sync_changes').add({
      table: 'tasks', recordId: 1, action: 'create',
      data: {}, timestamp: new Date().toISOString(), synced: false
    });
    tx.objectStore('__sync_meta').put({
      table: 'tasks', lastPushAt: new Date().toISOString(), lastPullAt: new Date().toISOString(), lastSyncCursor: 'abc'
    });
    await new Promise(r => setTimeout(r, 10));

    await engine.clearSyncData('tasks');

    const pending = await engine.getPendingCount('tasks');
    expect(pending).toBe(0);
  });
});
