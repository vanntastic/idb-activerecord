import { describe, it, expect, vi } from 'vitest';
import { TursoAdapter } from '../src/adapters/turso-adapter.js';
import { SQLiteAdapter } from '../src/adapters/sqlite-adapter.js';
import { Database, ActiveRecord } from '../src/index.js';
import { MockIDBDatabase } from './mocks/indexeddb.js';

describe('Sync SQL Index Provisioning', () => {
  describe('TursoAdapter index provisioning', () => {
    it('executes CREATE INDEX IF NOT EXISTS for declared indexes', async () => {
      const executedSql: string[] = [];
      const client = {
        prepare: (sql: string) => ({
          run: (..._args: any[]) => {
            executedSql.push(sql);
            return { changes: 0 };
          },
          all: (..._args: any[]) => {
            executedSql.push(sql);
            if (sql.includes('sqlite_master')) return [];
            return [];
          }
        }),
        close: vi.fn()
      };

      const adapter = new TursoAdapter();
      await adapter.connect({ client: client as any });

      await adapter.ensureTable('tasks', [
        { name: 'id', type: 'string', primaryKey: true, nullable: false },
        { name: 'title', type: 'string', nullable: false },
        { name: 'completed', type: 'boolean', nullable: false }
      ], [
        { name: 'idx_tasks_completed', columns: ['completed'], unique: false }
      ]);

      const indexSql = executedSql.find(sql => sql.includes('CREATE INDEX'));
      expect(indexSql).toBeDefined();
      expect(indexSql).toBe('CREATE INDEX IF NOT EXISTS "idx_tasks_completed" ON "tasks" ("completed")');
    });

    it('creates UNIQUE indexes when unique: true', async () => {
      const executedSql: string[] = [];
      const client = {
        prepare: (sql: string) => ({
          run: (..._args: any[]) => {
            executedSql.push(sql);
            return { changes: 0 };
          },
          all: (..._args: any[]) => {
            executedSql.push(sql);
            if (sql.includes('sqlite_master')) return [];
            return [];
          }
        }),
        close: vi.fn()
      };

      const adapter = new TursoAdapter();
      await adapter.connect({ client: client as any });

      await adapter.ensureTable({
        name: 'users',
        columns: [
          { name: 'id', type: 'string', primaryKey: true, nullable: false },
          { name: 'email', type: 'string', nullable: false }
        ],
        indexes: [
          { name: 'idx_users_email', columns: ['email'], unique: true }
        ]
      });

      const uniqueIndexSql = executedSql.find(sql => sql.includes('CREATE UNIQUE INDEX'));
      expect(uniqueIndexSql).toBeDefined();
      expect(uniqueIndexSql).toBe('CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_email" ON "users" ("email")');
    });

    it('rejects unsafe index column and name identifiers', async () => {
      const client = {
        prepare: () => ({ run: vi.fn(), all: vi.fn().mockReturnValue([]) }),
        close: vi.fn()
      };

      const adapter = new TursoAdapter();
      await adapter.connect({ client: client as any });

      await expect(adapter.ensureTable('tasks', [
        { name: 'id', type: 'string', primaryKey: true, nullable: false }
      ], [
        { name: 'idx_tasks_injection"; DROP TABLE tasks;--', columns: ['title'], unique: false }
      ])).rejects.toThrow(/Invalid index name/);

      await expect(adapter.ensureTable('tasks', [
        { name: 'id', type: 'string', primaryKey: true, nullable: false }
      ], [
        { name: 'idx_tasks_bad', columns: ['col"; DROP TABLE users;--'], unique: false }
      ])).rejects.toThrow(/Invalid index column identifier/);
    });
  });

  describe('SQLiteAdapter index provisioning', () => {
    it('executes CREATE INDEX IF NOT EXISTS for declared indexes', async () => {
      const executedSql: string[] = [];
      const client = {
        prepare: (sql: string) => ({
          run: (..._args: any[]) => {
            executedSql.push(sql);
            return { changes: 0, lastInsertRowid: 0 };
          },
          all: (..._args: any[]) => {
            executedSql.push(sql);
            if (sql.includes('sqlite_master')) return [];
            return [];
          },
          get: () => undefined
        }),
        close: vi.fn()
      };

      const adapter = new SQLiteAdapter();
      await adapter.connect({ client: client as any });

      await adapter.ensureTable('events', [
        { name: 'id', type: 'string', primaryKey: true, nullable: false },
        { name: 'timestamp', type: 'datetime', nullable: false }
      ], [
        { name: 'idx_events_timestamp', columns: ['timestamp'], unique: false }
      ]);

      const indexSql = executedSql.find(sql => sql.includes('CREATE INDEX'));
      expect(indexSql).toBeDefined();
      expect(indexSql).toBe('CREATE INDEX IF NOT EXISTS "idx_events_timestamp" ON "events" ("timestamp")');
    });
  });

  describe('Database forwards model indexes in ensureTable', async () => {
    it('extracts static indexes from registered models', async () => {
      class IndexedTask extends ActiveRecord<IndexedTask> {
        static tableName = 'indexed_tasks';
        static enableSync = true;
        static columns = {
          priority: { type: 'integer' }
        };
        static indexes = [
          { name: 'idx_tasks_priority', keyPath: 'priority' }
        ];
      }

      const capturedIndexes: any[] = [];
      const mockAdapter = {
        config: { url: '' },
        state: { lastSyncAt: null, lastPushAt: null, lastPullAt: null, status: 'idle', pendingOperations: 0 },
        connect: vi.fn(),
        disconnect: vi.fn(),
        isConnected: () => true,
        pull: vi.fn().mockResolvedValue([]),
        push: vi.fn().mockResolvedValue({ pushed: 0, pulled: 0, conflicts: 0, errors: [], timestamp: new Date() }),
        getRemoteSchema: vi.fn(),
        applyMigration: vi.fn(),
        ensureTable: vi.fn().mockImplementation(async (_table: string, _cols?: any[], idxs?: any[]) => {
          if (idxs) capturedIndexes.push(...idxs);
        }),
        resolveConflict: vi.fn()
      };

      const db = new Database('idx_db');
      db.registerModel(IndexedTask);

      const mockDb = new MockIDBDatabase('idx_db', 1);
      mockDb.createObjectStore('__sync_meta', { keyPath: 'table' });
      const cs = mockDb.createObjectStore('__sync_changes', { keyPath: 'id', autoIncrement: true });
      cs.createIndex('table', 'table', { unique: false });
      cs.createIndex('synced', 'synced', { unique: false });
      mockDb.createObjectStore('indexed_tasks', { keyPath: 'id' });

      IndexedTask.setDatabase(mockDb as any);
      (db as any).db = mockDb;

      await db.sync('indexed_tasks', mockAdapter as any);
      expect(capturedIndexes.length).toBe(1);
      expect(capturedIndexes[0].name).toBe('idx_tasks_priority');
      expect(capturedIndexes[0].columns).toEqual(['priority']);
    });
  });
});
