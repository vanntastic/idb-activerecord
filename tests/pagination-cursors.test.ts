import { describe, it, expect, beforeEach } from 'vitest';
import { SyncEngine } from '../src/sync-engine';
import { BaseAdapter, SyncQuery, SyncResult, SyncStatus } from '../src/sync-adapter';
import { MockIDBDatabase } from './mocks/indexeddb';

class PaginatedMockAdapter extends BaseAdapter {
  records: any[] = [];
  pullCallCount = 0;
  pulledQueries: SyncQuery[] = [];
  serverTimeToReturn = '2026-11-25T12:00:00.000Z';

  async connect(): Promise<void> {
    this.connected = true;
    this.updateState({ status: SyncStatus.IDLE });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async pull<T>(query: SyncQuery): Promise<T[]> {
    this.pullCallCount++;
    this.pulledQueries.push(query);

    const pageSize = query.limit || 1000;
    let filtered = [...this.records];

    if (query.cursor) {
      // Decode composite cursor (updatedAt__id)
      let raw = query.cursor;
      try {
        raw = typeof atob === 'function' ? atob(query.cursor) : Buffer.from(query.cursor, 'base64').toString('utf-8');
      } catch {}

      if (raw.includes('__')) {
        const [cTime, cId] = raw.split('__');
        filtered = filtered.filter(r => {
          if (r.updatedAt > cTime) return true;
          if (r.updatedAt === cTime && r.id > cId) return true;
          return false;
        });
      }
    } else if (query.since) {
      filtered = filtered.filter(r => new Date(r.updatedAt) > query.since!);
    }

    // Sort deterministically: updatedAt ASC, id ASC
    filtered.sort((a, b) => {
      if (a.updatedAt !== b.updatedAt) return a.updatedAt.localeCompare(b.updatedAt);
      return a.id.localeCompare(b.id);
    });

    const pageSlice = filtered.slice(0, pageSize);
    const hasMore = filtered.length > pageSize;

    let nextCursor: string | undefined = undefined;
    if (pageSlice.length > 0 && hasMore) {
      const last = pageSlice[pageSlice.length - 1];
      const raw = `${last.updatedAt}__${last.id}`;
      nextCursor = typeof btoa === 'function' ? btoa(raw) : Buffer.from(raw).toString('base64');
    }

    const result = pageSlice as T[];
    Object.defineProperties(result, {
      serverTime: { value: this.serverTimeToReturn, writable: true, configurable: true, enumerable: false },
      cursor: { value: nextCursor, writable: true, configurable: true, enumerable: false },
      hasMore: { value: hasMore, writable: true, configurable: true, enumerable: false }
    });

    return result;
  }

  async push<T>(): Promise<SyncResult> {
    return { pushed: 0, pulled: 0, conflicts: 0, errors: [], timestamp: new Date() };
  }

  async getRemoteSchema(table: string) {
    return { name: table, columns: [], indexes: [] };
  }
  async ensureTable() {}
  async applyMigration() {}
}

describe('Paginated Remote Pulls & Server Cursors', () => {
  let mockDb: any;
  let engine: SyncEngine;

  beforeEach(() => {
    mockDb = new MockIDBDatabase();
    mockDb.createObjectStore('tasks', { keyPath: 'id' });
    mockDb.createObjectStore('__sync_meta', { keyPath: 'table' });
    const changeStore = mockDb.createObjectStore('__sync_changes', { keyPath: 'id', autoIncrement: true });
    changeStore.createIndex('table', 'table', { unique: false });
    changeStore.createIndex('synced', 'synced', { unique: false });

    engine = new SyncEngine();
    engine.setDatabase(mockDb);
  });

  it('pulls all records past 1,000 threshold in a pagination loop without stranding data', async () => {
    const adapter = new PaginatedMockAdapter();
    await adapter.connect();

    // Populate 2,500 remote records across 3 pages (1000 + 1000 + 500)
    const baseTime = Date.now() - 100000;
    adapter.records = Array.from({ length: 2500 }, (_, i) => ({
      id: `task-${String(i).padStart(5, '0')}`,
      title: `Task ${i}`,
      // Introduce some identical timestamps to verify composite cursor tie-breaking
      updatedAt: new Date(baseTime + Math.floor(i / 10) * 1000).toISOString(),
      _version: 1,
      owner_id: 'alice'
    }));

    const pulled = await engine.pullChanges('tasks', adapter);
    expect(pulled.length).toBe(2500);
    // Should have called pull 3 times
    expect(adapter.pullCallCount).toBe(3);

    // Verify all IDs are present and none were skipped or duplicated
    const ids = pulled.map(r => r.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(2500);
  });

  it('stores server-generated serverTime in sync metadata, eliminating clock-skew data loss', async () => {
    const adapter = new PaginatedMockAdapter();
    adapter.serverTimeToReturn = '2026-11-25T18:45:00.000Z';
    await adapter.connect();

    adapter.records = [
      { id: 't1', title: 'Task 1', updatedAt: '2026-11-25T18:00:00.000Z', _version: 1 }
    ];

    const syncResult = await engine.sync('tasks', adapter);
    expect(syncResult.pulled).toBe(1);

    const meta = await engine.getSyncMeta('tasks');
    // lastPullAt must equal the serverTime from the server, not local client new Date()
    expect(meta.lastPullAt).toBe('2026-11-25T18:45:00.000Z');
  });

  it('composite cursor (updatedAt + id) ensures records with identical timestamps are not skipped across page boundaries', async () => {
    const adapter = new PaginatedMockAdapter();
    await adapter.connect();

    // 100 records sharing the EXACT same timestamp
    const sharedTimestamp = '2026-11-25T10:00:00.000Z';
    adapter.records = Array.from({ length: 15 }, (_, i) => ({
      id: `task-${String(i).padStart(3, '0')}`,
      updatedAt: sharedTimestamp,
      _version: 1
    }));

    // Test with small limit to force page boundary right in the middle of identical timestamps
    const query: SyncQuery = { table: 'tasks', limit: 10 };
    const page1 = await adapter.pull<any>(query);
    expect(page1.length).toBe(10);
    expect(page1[9].id).toBe('task-009');

    const cursor = (page1 as any).cursor;
    expect(cursor).toBeDefined();

    const page2 = await adapter.pull<any>({ table: 'tasks', limit: 10, cursor });
    expect(page2.length).toBe(5);
    expect(page2[0].id).toBe('task-010');
    expect(page2[4].id).toBe('task-014');
  });
});
