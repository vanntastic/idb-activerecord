import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../src/database';
import { ActiveRecord } from '../src/activerecord';
import { BaseAdapter, SyncResult, SyncStatus } from '../src/sync-adapter';
import { MockIDBDatabase } from './mocks/indexeddb';

class MockRemoteAdapter extends BaseAdapter {
  pushedRecords: any[] = [];
  tables = new Map<string, any[]>();

  async connect(): Promise<void> {
    this.connected = true;
    this.updateState({ status: SyncStatus.IDLE });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async pull<T>(_query: any): Promise<T[]> {
    return [] as T[];
  }

  async push<T>(records: T[], options?: any): Promise<SyncResult> {
    this.pushedRecords.push(...(records as any[]));
    const table = options?.table || 'tasks';
    if (!this.tables.has(table)) this.tables.set(table, []);
    this.tables.get(table)!.push(...(records as any[]));

    return {
      pushed: records.length,
      pulled: 0,
      conflicts: 0,
      errors: [],
      timestamp: new Date()
    };
  }

  async getRemoteSchema(table: string) {
    return { name: table, columns: [], indexes: [] };
  }

  async ensureTable() {}
  async applyMigration() {}
}

describe('Existing POC Data Backfill (db.backfillSync)', () => {
  let mockDb: any;
  let db: Database;

  class Task extends ActiveRecord<any> {
    static tableName = 'tasks';
    static enableSync = true;
  }

  class Note extends ActiveRecord<any> {
    static tableName = 'notes';
    static enableSync = true;
  }

  class LocalOnlyLog extends ActiveRecord<any> {
    static tableName = 'logs';
    static enableSync = false;
  }

  beforeEach(async () => {
    mockDb = new MockIDBDatabase();
    mockDb.createObjectStore('tasks', { keyPath: 'id' });
    mockDb.createObjectStore('notes', { keyPath: 'id' });
    mockDb.createObjectStore('logs', { keyPath: 'id' });
    mockDb.createObjectStore('__sync_meta', { keyPath: 'table' });
    const changeStore = mockDb.createObjectStore('__sync_changes', { keyPath: 'id', autoIncrement: true });
    changeStore.createIndex('table', 'table', { unique: false });
    changeStore.createIndex('synced', 'synced', { unique: false });

    db = new Database('test-backfill');
    (db as any).db = mockDb;
    db.registerModel(Task);
    db.registerModel(Note);
    db.registerModel(LocalOnlyLog);

    Task.setDatabase(mockDb);
    Note.setDatabase(mockDb);
    LocalOnlyLog.setDatabase(mockDb);
  });

  it('backfills pre-existing local records created before sync was enabled', async () => {
    // Simulate pre-existing records created without updatedAt and _version
    const tasksStore = mockDb.transaction(['tasks'], 'readwrite').objectStore('tasks');
    tasksStore.add({ id: 'task-1', title: 'POC Task 1' });
    tasksStore.add({ id: 'task-2', title: 'POC Task 2' });

    const result = await db.backfillSync('tasks');
    expect(result.tables).toEqual(['tasks']);
    expect(result.queuedCount).toBe(2);
    expect(result.skippedCount).toBe(0);

    // Verify __sync_changes store has staged entries
    const changesStore = mockDb.transaction(['__sync_changes'], 'readonly').objectStore('__sync_changes');
    const changes = await new Promise<any[]>((resolve) => {
      const req = changesStore.getAll();
      req.onsuccess = () => resolve(req.result);
    });

    expect(changes.length).toBe(2);
    expect(changes[0].recordId).toBe('task-1');
    expect(changes[0].action).toBe('create');
    expect(changes[0].data._version).toBe(1);
    expect(typeof changes[0].data.updatedAt).toBe('string');
    expect(changes[0].synced).toBe(false);

    // Verify local records in table were updated with _version and updatedAt
    const updatedTask = await new Promise<any>((resolve) => {
      const req = tasksStore.get('task-1');
      req.onsuccess = () => resolve(req.result);
    });
    expect(updatedTask._version).toBe(1);
    expect(typeof updatedTask.updatedAt).toBe('string');
  });

  it('is idempotent: running backfill repeatedly skips already-queued records', async () => {
    const tasksStore = mockDb.transaction(['tasks'], 'readwrite').objectStore('tasks');
    tasksStore.add({ id: 'task-a', title: 'Task A' });

    const firstRun = await db.backfillSync('tasks');
    expect(firstRun.queuedCount).toBe(1);
    expect(firstRun.skippedCount).toBe(0);

    const secondRun = await db.backfillSync('tasks');
    expect(secondRun.queuedCount).toBe(0);
    expect(secondRun.skippedCount).toBe(1);

    const changesStore = mockDb.transaction(['__sync_changes'], 'readonly').objectStore('__sync_changes');
    const changes = await new Promise<any[]>((resolve) => {
      const req = changesStore.getAll();
      req.onsuccess = () => resolve(req.result);
    });

    // Still only 1 change queued, no duplicates
    expect(changes.length).toBe(1);
  });

  it('backfills all sync-enabled registered models when tableName is omitted', async () => {
    const tasksStore = mockDb.transaction(['tasks'], 'readwrite').objectStore('tasks');
    tasksStore.add({ id: 't1', title: 'Task 1' });

    const notesStore = mockDb.transaction(['notes'], 'readwrite').objectStore('notes');
    notesStore.add({ id: 'n1', body: 'Note 1' });

    const logsStore = mockDb.transaction(['logs'], 'readwrite').objectStore('logs');
    logsStore.add({ id: 'l1', message: 'Log 1' });

    const result = await db.backfillSync();
    // Must include 'tasks' and 'notes', but NOT 'logs' (enableSync = false)
    expect(result.tables.sort()).toEqual(['notes', 'tasks']);
    expect(result.queuedCount).toBe(2);

    const changesStore = mockDb.transaction(['__sync_changes'], 'readonly').objectStore('__sync_changes');
    const changes = await new Promise<any[]>((resolve) => {
      const req = changesStore.getAll();
      req.onsuccess = () => resolve(req.result);
    });

    expect(changes.length).toBe(2);
    const tablesQueued = changes.map(c => c.table).sort();
    expect(tablesQueued).toEqual(['notes', 'tasks']);
  });

  it('pushes staged backfilled changes cleanly on subsequent sync()', async () => {
    const tasksStore = mockDb.transaction(['tasks'], 'readwrite').objectStore('tasks');
    tasksStore.add({ id: 'task-backfill-sync', title: 'To Sync to Cloud' });

    await db.backfillSync('tasks');

    const adapter = new MockRemoteAdapter();
    await adapter.connect();

    const syncResult = await db.sync('tasks', adapter);
    expect(syncResult.pushed).toBe(1);
    expect(adapter.pushedRecords.length).toBe(1);
    expect(adapter.pushedRecords[0].id).toBe('task-backfill-sync');
  });
});
