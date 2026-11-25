import { describe, it, expect, vi } from 'vitest';
import { TursoAdapter } from '../src/adapters/turso-adapter.js';
import { SQLiteAdapter } from '../src/adapters/sqlite-adapter.js';

describe('Atomic Push Transactions', () => {
  describe('TursoAdapter atomic push', () => {
    it('uses rawClient.batch when available on @libsql/client', async () => {
      const batchSpy = vi.fn().mockResolvedValue([]);
      const executeSpy = vi.fn().mockImplementation(async ({ sql }: { sql: string }) => {
        if (sql.includes('sqlite_master')) return { rows: [{ name: 'tasks' }], rowsAffected: 0, columns: ['name'] };
        if (sql.includes('PRAGMA table_info')) {
          return {
            rows: [
              { name: 'id', type: 'TEXT' },
              { name: 'title', type: 'TEXT' },
              { name: 'updatedAt', type: 'TEXT' },
              { name: 'version', type: 'INTEGER' },
              { name: 'deleted_at', type: 'TEXT' },
              { name: 'owner_id', type: 'TEXT' }
            ],
            rowsAffected: 0,
            columns: ['name', 'type']
          };
        }
        if (sql.includes('SELECT version')) return { rows: [], rowsAffected: 0, columns: ['version'] };
        return { rows: [], rowsAffected: 1, columns: [] };
      });

      const rawClient = {
        execute: executeSpy,
        batch: batchSpy,
        close: vi.fn()
      };

      const adapter = new TursoAdapter();
      await adapter.connect({ client: rawClient as any });

      const records = [
        { id: '1', title: 'Task 1', _version: 1 },
        { id: '2', title: 'Task 2', _version: 1 }
      ] as any;

      const result = await adapter.push(records, { table: 'tasks' });
      expect(result.pushed).toBe(2);
      expect(batchSpy).toHaveBeenCalledTimes(1);
      const batchArg = batchSpy.mock.calls[0][0];
      expect(batchArg).toHaveLength(2);
      expect(batchSpy.mock.calls[0][1]).toBe('write');
    });

    it('rolls back via BEGIN/ROLLBACK when SQL statement fails mid-batch in client mode', async () => {
      const log: string[] = [];
      const client = {
        prepare: (sql: string) => ({
          run: (...args: any[]) => {
            log.push(sql);
            if (args.some(a => String(a).includes('Task 2'))) {
              throw new Error('Disk full: write error');
            }
            return { changes: 1 };
          },
          all: (..._args: any[]) => {
            log.push(sql);
            if (sql.includes('PRAGMA table_info')) {
              return [
                { name: 'id', type: 'TEXT' },
                { name: 'title', type: 'TEXT' },
                { name: 'updatedAt', type: 'TEXT' },
                { name: 'version', type: 'INTEGER' },
                { name: 'deleted_at', type: 'TEXT' },
                { name: 'owner_id', type: 'TEXT' }
              ];
            }
            return [];
          }
        }),
        close: vi.fn()
      };

      const adapter = new TursoAdapter();
      await adapter.connect({ client: client as any });

      const records = [
        { id: '1', title: 'Task 1', _version: 1 },
        { id: '2', title: 'Task 2', _version: 1 }
      ] as any;

      await expect(adapter.push(records, { table: 'tasks' })).rejects.toThrow('Disk full: write error');
      expect(log).toContain('BEGIN');
      expect(log).toContain('ROLLBACK');
      expect(log).not.toContain('COMMIT');
    });
  });

  describe('SQLiteAdapter atomic push', () => {
    it('rolls back via BEGIN/ROLLBACK when mid-batch SQL failure occurs', async () => {
      const log: string[] = [];
      const client = {
        prepare: (sql: string) => ({
          run: (...args: any[]) => {
            log.push(sql);
            if (args.some(a => String(a).includes('Failing Item'))) {
              throw new Error('Constraint violation');
            }
            return { changes: 1, lastInsertRowid: 1 };
          },
          all: (..._args: any[]) => {
            log.push(sql);
            if (sql.includes('PRAGMA table_info')) {
              return [
                { name: 'id', type: 'TEXT' },
                { name: 'title', type: 'TEXT' },
                { name: 'updatedAt', type: 'TEXT' },
                { name: 'version', type: 'INTEGER' },
                { name: 'deleted_at', type: 'TEXT' },
                { name: 'owner_id', type: 'TEXT' }
              ];
            }
            return [];
          },
          get: () => undefined
        }),
        close: vi.fn()
      };

      const adapter = new SQLiteAdapter();
      await adapter.connect({ client: client as any });

      const records = [
        { id: '1', title: 'Good Item', _version: 1 },
        { id: '2', title: 'Failing Item', _version: 1 }
      ] as any;

      await expect(adapter.push(records, { table: 'items' })).rejects.toThrow('Constraint violation');
      expect(log).toContain('BEGIN');
      expect(log).toContain('ROLLBACK');
      expect(log).not.toContain('COMMIT');
    });
  });
});
