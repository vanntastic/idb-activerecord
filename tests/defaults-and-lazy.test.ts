import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Database, ActiveRecord } from '../src/index.js';
import { MockIDBDatabase } from './mocks/indexeddb.js';

describe('Zero-Config Database.default, Sensible Defaults & Auto-Discovery', () => {
  let mockDb: MockIDBDatabase;

  beforeEach(() => {
    mockDb = new MockIDBDatabase('test-db', 1);
    (globalThis as any).indexedDB = {
      open: vi.fn().mockImplementation(() => {
        const req: any = {
          result: mockDb,
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null
        };
        setTimeout(() => {
          if (req.onupgradeneeded) {
            req.onupgradeneeded({ target: req });
          }
          if (req.onsuccess) {
            req.onsuccess({ target: req });
          }
        }, 0);
        return req;
      })
    };
    ActiveRecord.defaults = {};
  });

  afterEach(() => {
    ActiveRecord.defaults = {};
  });

  describe('ActiveRecord.defaults global configuration', () => {
    it('applies global defaults to models when static properties are omitted', () => {
      ActiveRecord.defaults = {
        timestamps: true,
        versioning: true,
        softDelete: true,
        enableSync: true
      };

      class AutoModel extends ActiveRecord {
        static tableName = 'auto_models';
      }

      expect(AutoModel.isTimestampsEnabled).toBe(true);
      expect(AutoModel.isVersioningEnabled).toBe(true);
      expect(AutoModel.isSoftDeleteEnabled).toBe(true);
      expect(AutoModel.isSyncEnabled).toBe(true);
    });

    it('gives explicit static model properties precedence over global defaults', () => {
      ActiveRecord.defaults = {
        timestamps: true,
        versioning: true,
        softDelete: true,
        enableSync: true
      };

      class ExplicitModel extends ActiveRecord {
        static tableName = 'explicit_models';
        static timestamps = false;
        static versioning = false;
        static softDelete = false;
        static enableSync = false;
      }

      expect(ExplicitModel.isTimestampsEnabled).toBe(false);
      expect(ExplicitModel.isVersioningEnabled).toBe(false);
      expect(ExplicitModel.isSoftDeleteEnabled).toBe(false);
      expect(ExplicitModel.isSyncEnabled).toBe(false);
    });

    it('auto-manages createdAt, updatedAt, and _version when timestamps and versioning are enabled', async () => {
      ActiveRecord.defaults = {
        timestamps: true,
        versioning: true
      };

      mockDb.createObjectStore('items', { keyPath: 'id' });

      class Item extends ActiveRecord<Item> {
        static tableName = 'items';
      }

      Item.setDatabase(mockDb as any);

      const item = await Item.create({ name: 'Widget' } as any);
      expect(item.id).toBeDefined();
      expect(item.createdAt).toBeDefined();
      expect(item.updatedAt).toBeDefined();
      expect(item._version).toBe(1);

      const originalUpdatedAt = item.updatedAt;
      await new Promise(r => setTimeout(r, 10));

      await item.update({ name: 'Updated Widget' });
      expect(item.name).toBe('Updated Widget');
      expect(item._version).toBe(2);
      expect(item.updatedAt).not.toBe(originalUpdatedAt);
    });
  });

  describe('Database.default singleton and lazy auto-connect', () => {
    it('provides Database.default / Database.getDefault() and Database.setDefault()', () => {
      const db1 = Database.getDefault('test_app');
      expect(db1).toBeDefined();
      expect(Database.default).toBe(db1);

      const customDb = new Database('custom_db');
      Database.setDefault(customDb);
      expect(Database.default).toBe(customDb);
      expect(Database.getDefault()).toBe(customDb);
    });

    it('auto-registers and lazily connects on first query when not pre-connected', async () => {
      const defaultDb = new Database('lazy_app');
      Database.setDefault(defaultDb);

      class Note extends ActiveRecord<Note> {
        static tableName = 'notes';
      }

      // Ensure model is not registered yet
      expect(defaultDb.hasModel('notes')).toBe(false);

      const note = await Note.create({ title: 'Lazy note' } as any);
      expect(note).toBeDefined();
      expect(note.title).toBe('Lazy note');
      expect(defaultDb.hasModel('notes')).toBe(true);
      expect(defaultDb.isConnected()).toBe(true);

      const allNotes = await Note.all();
      expect(allNotes.length).toBeGreaterThanOrEqual(1);

      const found = await Note.find(note.id!);
      expect(found).toBeDefined();
      expect(found!.id).toBe(note.id);
    });

    it('supports lazy auto-connect on QueryBuilder chain', async () => {
      const defaultDb = new Database('lazy_qb_app');
      Database.setDefault(defaultDb);

      class Book extends ActiveRecord<Book> {
        static tableName = 'books';
      }

      await Book.create({ title: 'TypeScript Handbook', pages: 300 } as any);
      const results = await Book.where('pages', '>=', 100).all();
      expect(results.length).toBe(1);
      expect(results[0].title).toBe('TypeScript Handbook');
    });
  });

  describe('Simplified sync shorthands', () => {
    it('sync(table, { url }) creates HTTP TursoAdapter and syncs', async () => {
      const db = new Database('sync_app');
      class Task extends ActiveRecord {
        static tableName = 'tasks';
        static enableSync = true;
      }
      db.registerModel(Task);
      await db.connect();

      const fetchSpy = vi.fn().mockImplementation(async (url: string, opts?: any) => {
        if (url.includes('/schema')) {
          return new Response(JSON.stringify({ table: 'tasks', ensured: true }), { status: 200 });
        }
        if (opts?.method === 'POST') {
          return new Response(JSON.stringify({ pushed: 1, conflicts: 0, errors: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ records: [], hasMore: false }), { status: 200 });
      });
      globalThis.fetch = fetchSpy as any;

      const result = await db.sync('tasks', {
        url: 'http://localhost:3000/api/sync',
        headers: { 'X-Custom': 'test' }
      });

      expect(result).toBeDefined();
      expect(result.pushed).toBeDefined();
      expect(result.pulled).toBeDefined();
    });

    it('syncAll({ url }) syncs all sync-enabled registered models and returns per-table results', async () => {
      const db = new Database('sync_all_app');
      class Project extends ActiveRecord {
        static tableName = 'projects';
        static enableSync = true;
      }
      class Tag extends ActiveRecord {
        static tableName = 'tags';
        static enableSync = false;
      }

      db.registerModel(Project);
      db.registerModel(Tag);
      await db.connect();

      const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/schema')) {
          return new Response(JSON.stringify({ ensured: true }), { status: 200 });
        }
        return new Response(JSON.stringify({ records: [] }), { status: 200 });
      });
      globalThis.fetch = fetchSpy as any;

      const results = await db.syncAll({ url: 'http://localhost:3000/api/sync' });
      expect(results.projects).toBeDefined();
      expect(results.tags).toBeUndefined(); // enableSync was false
    });

    it('initializes sync from Database constructor options', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ records: [] }), { status: 200 }));
      globalThis.fetch = fetchSpy as any;

      const db = new Database('constructor_sync_app', {
        sync: {
          url: 'http://localhost:3000/api/sync',
          auto: true,
          interval: 5000,
          offlineQueue: true
        }
      });

      await db.connect();
      expect(db.isConnected()).toBe(true);
      db.disableAutoSync();
    });
  });
});
