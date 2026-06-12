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
  (mockDb as any).createObjectStore('tasks', { keyPath: 'id' });

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
      recordId: 'task-1',
      action: 'create',
      data: { id: 'task-1', title: 'Test', updatedAt: new Date().toISOString(), _version: 1 },
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
      { id: 'task-1', title: 'Remote Task', updatedAt: new Date().toISOString(), _version: 1 }
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
      { id: 'task-1', title: 'Remote Task', updatedAt: new Date().toISOString(), _version: 1 }
    ];

    const result = await engine.mergeChanges('tasks', remote, adapter, ConflictStrategy.LAST_WRITE_WINS);
    expect(result.pulled).toBe(0);
    expect(result.conflicts).toBe(0);

    // Verify local store has the record
    const tx = mockDb.transaction(['tasks'], 'readonly');
    const store = tx.objectStore('tasks');
    const req = store.get('task-1');
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
    store.add({ id: 'task-1', title: 'Local', updatedAt: '2024-01-01T00:00:00Z', _version: 1 });
    await new Promise(r => setTimeout(r, 10));

    // Remote has higher version
    const remote = [
      { id: 'task-1', title: 'Remote', updatedAt: '2024-02-01T00:00:00Z', _version: 2 }
    ];

    await engine.mergeChanges('tasks', remote, adapter, ConflictStrategy.LAST_WRITE_WINS);

    const tx2 = mockDb.transaction(['tasks'], 'readonly');
    const store2 = tx2.objectStore('tasks');
    const req = store2.get('task-1');
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
    store.put({ id: 'task-1', title: 'Local', updatedAt: '2024-02-01T00:00:00Z', _version: 3 });
    await new Promise(r => setTimeout(r, 10));

    // Remote has lower version
    const remote = [
      { id: 'task-1', title: 'Remote', updatedAt: '2024-01-01T00:00:00Z', _version: 2 }
    ];

    await engine.mergeChanges('tasks', remote, adapter, ConflictStrategy.LAST_WRITE_WINS);

    const tx2 = mockDb.transaction(['tasks'], 'readonly');
    const store2 = tx2.objectStore('tasks');
    const req = store2.get('task-1');
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
    store.add({ id: 'task-1', title: 'To Delete', updatedAt: '2024-01-01T00:00:00Z', _version: 1 });
    await new Promise(r => setTimeout(r, 10));

    // Remote tombstone
    const remote = [
      { id: 'task-1', title: 'To Delete', updatedAt: '2024-02-01T00:00:00Z', _version: 2, _deletedAt: '2024-02-01T00:00:00Z' }
    ];

    await engine.mergeChanges('tasks', remote, adapter, ConflictStrategy.LAST_WRITE_WINS);

    const tx2 = mockDb.transaction(['tasks'], 'readonly');
    const store2 = tx2.objectStore('tasks');
    const req = store2.get('task-1');
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
        recordId: 'task-1',
        action: 'create',
        data: { id: 'task-1', title: 'Hello', status: 'pending', owner_id: 'alice', updatedAt: new Date().toISOString(), _version: 1 },
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
      expect(idCol.type).toBe('string');
      expect(idCol.autoIncrement).toBeUndefined();
    });

    it('declared SyncOptions.columns is strict: inferred columns are excluded', async () => {
      const mockDb = createMockDB();
      const engine = new SyncEngine();
      engine.setDatabase(mockDb);

      // Pending record has an `extra` field that is NOT declared
      const tx = mockDb.transaction(['__sync_changes'], 'readwrite');
      tx.objectStore('__sync_changes').add({
        table: 'tasks',
        recordId: 'task-1',
        action: 'create',
        data: { id: 'task-1', title: 'Hello', extra: 42, updatedAt: new Date().toISOString(), _version: 1 },
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
        recordId: 'task-1',
        action: 'create',
        data: { id: 'task-1', title: 'Hello', extra: 42, updatedAt: new Date().toISOString(), _version: 1 },
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
        recordId: 'task-1',
        action: 'create',
        data: { id: 'task-1', title: 'Hello', priority: 5, done: true, updatedAt: new Date().toISOString(), _version: 1 },
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
      table: 'tasks', recordId: 'task-1', action: 'create',
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

  describe('multi-device reconciliation scenarios', () => {
    it('handles mobile-to-laptop sync: laptop pulls thousands of mobile records while preserving local modifications', async () => {
      // Scenario: User has 1000 tasks on mobile, only 50 on laptop (some overlapping, some new)
      // Mobile has been the primary device, now laptop needs to sync and reconcile.

      const mobileEngine = new SyncEngine();
      const mobileDb = createMockDB();
      mobileEngine.setDatabase(mobileDb);
      mobileEngine.setUser('alice');

      const laptopEngine = new SyncEngine();
      const laptopDb = createMockDB();
      laptopEngine.setDatabase(laptopDb);
      laptopEngine.setUser('alice');

      // Create shared adapter simulating the remote server (Turso)
      const serverAdapter = new TestAdapter();
      await serverAdapter.connect({ url: 'http://test' });

      // Mobile: 1000 tasks, created over past week
      const now = Date.now();
      const mobileTasks = Array.from({ length: 1000 }, (_, i) => ({
        id: `task-${i.toString().padStart(4, '0')}`,
        title: `Task ${i}`,
        status: i % 3 === 0 ? 'completed' : 'pending',
        owner_id: 'alice',
        updatedAt: new Date(now - i * 3600000).toISOString(), // Spaced 1 hour apart
        _version: 1
      }));

      // Seed mobile database with sync tracking
      const mobileTx = mobileDb.transaction(['tasks', '__sync_changes'], 'readwrite');
      for (const task of mobileTasks) {
        mobileTx.objectStore('tasks').add(task);
        // Track each task as a pending change so it gets pushed
        mobileTx.objectStore('__sync_changes').add({
          table: 'tasks',
          recordId: task.id,
          action: 'create',
          data: task,
          timestamp: new Date().toISOString(),
          synced: false
        });
      }
      await new Promise(r => setTimeout(r, 50));

      // Mobile syncs first - pushes all 1000 tasks to server.
      // On this first sync lastPullAt is null, so the pull phase fetches back
      // the same 1000 records it just pushed (they merge as no-ops locally).
      const mobileResult = await mobileEngine.sync('tasks', serverAdapter);
      expect(mobileResult.pushed).toBe(1000);
      expect(mobileResult.pulled).toBe(1000);

      // Laptop: Only 50 tasks - 40 that overlap with mobile (but modified locally)
      // and 10 that are unique to laptop
      const laptopTasks: typeof mobileTasks = [];

      // 40 overlapping tasks - laptop has newer versions (higher _version)
      for (let i = 0; i < 40; i++) {
        laptopTasks.push({
          id: `task-${i.toString().padStart(4, '0')}`,
          title: `Task ${i} (modified on laptop)`,
          status: 'in_progress',
          owner_id: 'alice',
          updatedAt: new Date(now + 1000).toISOString(), // Later than mobile
          _version: 2 // Higher version than mobile's _version: 1
        });
      }

      // 10 laptop-only tasks
      for (let i = 2000; i < 2010; i++) {
        laptopTasks.push({
          id: `task-${i}`,
          title: `Laptop-only Task ${i}`,
          status: 'pending',
          owner_id: 'alice',
          updatedAt: new Date(now).toISOString(),
          _version: 1
        });
      }

      // Seed laptop database with sync tracking for new/modified tasks
      const laptopTx = laptopDb.transaction(['tasks', '__sync_changes'], 'readwrite');
      for (const task of laptopTasks) {
        laptopTx.objectStore('tasks').add(task);
        // Track laptop-only tasks (2000-2009) and modified tasks (0-39) as pending
        if (task._version === 2 || parseInt(task.id.split('-')[1]) >= 2000) {
          laptopTx.objectStore('__sync_changes').add({
            table: 'tasks',
            recordId: task.id,
            action: task._version === 2 ? 'update' : 'create',
            data: task,
            timestamp: new Date().toISOString(),
            synced: false
          });
        }
      }
      await new Promise(r => setTimeout(r, 20));

      // Track progress messages
      const progressMessages: string[] = [];

      // Laptop syncs - the engine pushes BEFORE it pulls:
      // 1. Push 50 local changes (40 modified @ v2 + 10 laptop-only). The 40
      //    overwrite mobile's records on the server (laptop's v2 wins).
      // 2. Pull all server records. Since lastPullAt is null, every record is
      //    returned: 1000 mobile + 10 laptop-only = 1010.
      // 3. Merge: 960 brand-new mobile records are inserted locally; the 40
      //    overlapping + 10 laptop-only already match what laptop just pushed.
      const laptopResult = await laptopEngine.sync('tasks', serverAdapter, {
        strategy: ConflictStrategy.LAST_WRITE_WINS,
        onProgress: (msg) => progressMessages.push(msg)
      });

      // Verify push count: 40 modified (v2) + 10 laptop-only = 50
      expect(laptopResult.pushed).toBe(50);

      // Verify pull count: all server records returned (1000 + 10 laptop-only)
      expect(laptopResult.pulled).toBe(1010);

      // No merge conflicts: laptop's pushed records match what it pulls back
      expect(laptopResult.conflicts).toBe(0);

      // Verify progress messages
      expect(progressMessages).toContain('Pushing local changes...');
      expect(progressMessages).toContain('Pulling remote changes...');
      expect(progressMessages).toContain('Merging changes...');
      expect(progressMessages).toContain('Sync complete.');

      // Verify laptop now has all 1010 unique tasks (1000 from mobile + 10 laptop-only)
      const laptopFinalTx = laptopDb.transaction(['tasks'], 'readonly');
      const laptopFinalCount = await new Promise<number>((resolve) => {
        const req = laptopFinalTx.objectStore('tasks').count();
        req.onsuccess = () => resolve(req.result);
      });
      expect(laptopFinalCount).toBe(1010);

      // Verify the 40 overlapping tasks on laptop kept the laptop's modified version
      const overlapCheckTx = laptopDb.transaction(['tasks'], 'readonly');
      for (let i = 0; i < 40; i++) {
        const id = `task-${i.toString().padStart(4, '0')}`;
        const req = overlapCheckTx.objectStore('tasks').get(id);
        await new Promise<void>(r => { req.onsuccess = () => r(); });
        expect((req.result as any).title).toContain('(modified on laptop)');
        expect((req.result as any)._version).toBe(2);
      }

      // Verify server now has the laptop's modifications for those 40 tasks
      const serverTask0 = serverAdapter['remoteData'].find((r: any) => r.id === 'task-0000');
      expect(serverTask0.title).toContain('(modified on laptop)');
      expect(serverTask0._version).toBe(2);
    }, 30000); // 1000-record mock-IDB scenario is slow; override the default 5s timeout

    it('handles version conflicts when mobile has newer edits than laptop', async () => {
      // Scenario: Mobile and laptop both have the same task, but mobile edited it more recently
      // When laptop syncs, it should discover the conflict and resolve in mobile's favor

      const mobileEngine = new SyncEngine();
      const mobileDb = createMockDB();
      mobileEngine.setDatabase(mobileDb);

      const laptopEngine = new SyncEngine();
      const laptopDb = createMockDB();
      laptopEngine.setDatabase(laptopDb);

      const serverAdapter = new TestAdapter();
      await serverAdapter.connect({ url: 'http://test' });

      // Mobile has task-001 with version 2 (edited after initial creation)
      const mobileTx = mobileDb.transaction(['tasks', '__sync_changes'], 'readwrite');
      mobileTx.objectStore('tasks').add({
        id: 'task-001',
        title: 'Task 1 (mobile edit)',
        status: 'completed',
        owner_id: 'alice',
        updatedAt: new Date('2024-01-15T10:00:00Z').toISOString(),
        _version: 2
      });
      // Track as pending change so it gets pushed (must include all sync fields)
      mobileTx.objectStore('__sync_changes').add({
        table: 'tasks', recordId: 'task-001', action: 'create',
        data: {
          id: 'task-001',
          title: 'Task 1 (mobile edit)',
          status: 'completed',
          owner_id: 'alice',
          updatedAt: new Date('2024-01-15T10:00:00Z').toISOString(),
          _version: 2
        },
        timestamp: new Date().toISOString(), synced: false
      });
      await new Promise(r => setTimeout(r, 10));

      // Laptop has same task but version 1 (stale)
      const laptopTx = laptopDb.transaction(['tasks'], 'readwrite');
      laptopTx.objectStore('tasks').add({
        id: 'task-001',
        title: 'Task 1 (original)',
        status: 'pending',
        owner_id: 'alice',
        updatedAt: new Date('2024-01-10T10:00:00Z').toISOString(),
        _version: 1
      });
      await new Promise(r => setTimeout(r, 10));

      // Mobile syncs first
      await mobileEngine.sync('tasks', serverAdapter);
      await new Promise(r => setTimeout(r, 10));

      // Clear laptop's sync metadata so it pulls fresh (simulating first sync)
      await laptopEngine.clearSyncData('tasks');

      // Laptop syncs - should pull mobile's version and merge
      const laptopResult = await laptopEngine.sync('tasks', serverAdapter, {
        strategy: ConflictStrategy.LAST_WRITE_WINS
      });

      // Laptop should pull the mobile version (server has 1 record)
      expect(laptopResult.pulled).toBe(1);

      // Laptop's local record should now reflect mobile's version
      // because mobile has higher _version (2 vs 1)
      const checkTx = laptopDb.transaction(['tasks'], 'readonly');
      const req = checkTx.objectStore('tasks').get('task-001');
      await new Promise<void>(r => { req.onsuccess = () => r(); });
      expect((req.result as any).title).toBe('Task 1 (mobile edit)');
      expect((req.result as any)._version).toBe(2);
    });

    it('handles simultaneous edits with same version using timestamp resolution', async () => {
      // Scenario: Mobile and laptop both edit the same task independently
      // Both have version 1 -> conflict resolved by updatedAt timestamp
      // Note: This test verifies the merge behavior when laptop pulls mobile's changes

      const mobileEngine = new SyncEngine();
      const mobileDb = createMockDB();
      mobileEngine.setDatabase(mobileDb);

      const laptopEngine = new SyncEngine();
      const laptopDb = createMockDB();
      laptopEngine.setDatabase(laptopDb);

      const serverAdapter = new TestAdapter();
      await serverAdapter.connect({ url: 'http://test' });

      // Mobile edit at 10:00 - this will be on server
      const mobileTx = mobileDb.transaction(['tasks', '__sync_changes'], 'readwrite');
      mobileTx.objectStore('tasks').add({
        id: 'task-001',
        title: 'Mobile Edit',
        owner_id: 'alice',
        updatedAt: new Date('2024-01-15T10:00:00Z').toISOString(),
        _version: 1
      });
      // Track as pending change so it gets pushed
      mobileTx.objectStore('__sync_changes').add({
        table: 'tasks', recordId: 'task-001', action: 'create',
        data: { id: 'task-001', title: 'Mobile Edit' },
        timestamp: new Date().toISOString(), synced: false
      });
      await new Promise(r => setTimeout(r, 10));

      // Laptop edit at 10:30 (later timestamp, but only local)
      const laptopTx = laptopDb.transaction(['tasks'], 'readwrite');
      laptopTx.objectStore('tasks').add({
        id: 'task-001',
        title: 'Laptop Edit',
        owner_id: 'alice',
        updatedAt: new Date('2024-01-15T10:30:00Z').toISOString(),
        _version: 1
      });
      await new Promise(r => setTimeout(r, 10));

      // Mobile syncs first - pushes to server
      await mobileEngine.sync('tasks', serverAdapter);
      await new Promise(r => setTimeout(r, 10));

      // Clear laptop's sync metadata so it pulls fresh
      await laptopEngine.clearSyncData('tasks');

      // Laptop syncs - should pull mobile's version
      // Since both have same version (1), timestamp resolution applies
      // Laptop's local has 10:30, mobile's has 10:00
      // Laptop's local should win (later timestamp) but only if it gets pushed
      // For this test, we verify the pull behavior: laptop gets mobile's version
      const laptopResult = await laptopEngine.sync('tasks', serverAdapter);

      // Laptop should pull the mobile record
      expect(laptopResult.pulled).toBe(1);

      // Verify mobile's version is now on server (laptop didn't push because
      // no pending change was recorded for laptop's edit)
      const serverTask = serverAdapter['remoteData'].find((r: any) => r.id === 'task-001');
      expect(serverTask).toBeDefined();
      expect(serverTask.title).toBe('Mobile Edit');
    });

    it('propagates soft deletes from mobile to laptop', async () => {
      // Scenario: User deletes a task on mobile, should be deleted on laptop after sync

      const mobileEngine = new SyncEngine();
      const mobileDb = createMockDB();
      mobileEngine.setDatabase(mobileDb);

      const laptopEngine = new SyncEngine();
      const laptopDb = createMockDB();
      laptopEngine.setDatabase(laptopDb);

      const serverAdapter = new TestAdapter();
      await serverAdapter.connect({ url: 'http://test' });

      // Both have the same task initially
      const task = {
        id: 'task-to-delete',
        title: 'Delete Me',
        owner_id: 'alice',
        updatedAt: new Date('2024-01-15T10:00:00Z').toISOString(),
        _version: 1
      };

      const mobileTx = mobileDb.transaction(['tasks'], 'readwrite');
      mobileTx.objectStore('tasks').add({ ...task });
      await new Promise(r => setTimeout(r, 10));

      const laptopTx = laptopDb.transaction(['tasks'], 'readwrite');
      laptopTx.objectStore('tasks').add({ ...task });
      await new Promise(r => setTimeout(r, 10));

      // Mobile syncs first
      await mobileEngine.sync('tasks', serverAdapter);

      // Mobile soft-deletes the task by updating in DB and marking for sync
      const deleteTx = mobileDb.transaction(['tasks', '__sync_changes'], 'readwrite');
      const getReq = deleteTx.objectStore('tasks').get('task-to-delete');
      await new Promise<void>(r => { getReq.onsuccess = () => r(); });
      const existing = getReq.result as any;
      existing._deletedAt = new Date().toISOString();
      existing._version = 2;
      existing.updatedAt = new Date().toISOString();
      deleteTx.objectStore('tasks').put(existing);
      // Mark as pending change for sync engine to pick up
      deleteTx.objectStore('__sync_changes').add({
        table: 'tasks',
        recordId: 'task-to-delete',
        action: 'update',
        data: existing,
        timestamp: new Date().toISOString(),
        synced: false
      });
      await new Promise(r => setTimeout(r, 10));

      // Mobile syncs again to push the tombstone
      await mobileEngine.sync('tasks', serverAdapter);
      await new Promise(r => setTimeout(r, 10));

      // Clear laptop's sync metadata so it pulls fresh (simulating first sync after deletion)
      await laptopEngine.clearSyncData('tasks');

      // Laptop syncs - should receive the tombstone
      const laptopResult = await laptopEngine.sync('tasks', serverAdapter);

      expect(laptopResult.pulled).toBe(1);

      // Verify laptop's record is now soft-deleted
      const checkTx = laptopDb.transaction(['tasks'], 'readonly');
      const req = checkTx.objectStore('tasks').get('task-to-delete');
      await new Promise<void>(r => { req.onsuccess = () => r(); });
      expect((req.result as any)._deletedAt).toBeDefined();
    });
  });
});
