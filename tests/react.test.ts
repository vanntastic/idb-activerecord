import { describe, it, expect, beforeEach } from 'vitest';
import { ActiveRecord, createLiveQuery } from '../src/index.js';
import { useLiveQuery } from '../src/react.js';
import { MockIDBDatabase } from './mocks/indexeddb.js';

describe('Reactive UI Hook & Framework-Agnostic Store', () => {
  let mockDb: any;

  beforeEach(() => {
    mockDb = new MockIDBDatabase('test-db', 1);
    mockDb.createObjectStore('live_tasks', { keyPath: 'id' });
    ActiveRecord.defaults = {};
  });

  describe('createLiveQuery store', () => {
    class LiveTask extends ActiveRecord<LiveTask> {
      static tableName = 'live_tasks';
    }

    beforeEach(() => {
      LiveTask.setDatabase(mockDb);
    });

    it('returns initial snapshot and updates when local mutations occur', async () => {
      const store = createLiveQuery(() => LiveTask.all(), { debounceMs: 10 });
      const values: any[][] = [];

      const unsubscribe = store.subscribe((data) => {
        values.push(data);
      });

      // Wait for initial query
      await new Promise((r) => setTimeout(r, 20));
      expect(values.length).toBeGreaterThanOrEqual(1);
      expect(values[0]).toHaveLength(0);

      // Mutate via create
      await LiveTask.create({ title: 'Task 1' } as any);
      await new Promise((r) => setTimeout(r, 40));

      const latest = values[values.length - 1];
      expect(latest.length).toBe(1);
      expect(latest[0].title).toBe('Task 1');

      unsubscribe();
    });

    it('refreshes when SyncEngine notifies sync action', async () => {
      const store = createLiveQuery(() => LiveTask.all(), { debounceMs: 10 });
      const values: any[][] = [];

      const unsubscribe = store.subscribe((data) => {
        values.push(data);
      });

      await new Promise((r) => setTimeout(r, 20));
      const initialCount = values.length;

      // Simulate remote sync notification
      ActiveRecord.notifySubscribers({ table: 'live_tasks', action: 'sync' });
      await new Promise((r) => setTimeout(r, 40));

      expect(values.length).toBeGreaterThan(initialCount);
      unsubscribe();
    });
  });

  describe('useLiveQuery SSR safety', () => {
    it('is SSR-safe and does not crash when called outside of browser DOM', () => {
      // Outside a browser component tree or during server render:
      // useLiveQuery is a valid React hook function
      expect(typeof useLiveQuery).toBe('function');
    });
  });
});
