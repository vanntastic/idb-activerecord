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
