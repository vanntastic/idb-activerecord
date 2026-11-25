import { describe, it, expect, beforeEach } from 'vitest';
import {
  IndexedDBStorageAdapter,
  TursoStorageAdapter,
  Database,
  ActiveRecord
} from '../src/index.js';
import { MockIDBDatabase } from './mocks/indexeddb.js';

class MockSqliteDriver {
  tables: Map<string, { columns: any[]; rows: any[]; nextId: number }> = new Map();
  log: Array<{ sql: string; args: any[] }> = [];

  prepare(sql: string) {
    const self = this;
    return {
      run(...args: any[]) {
        self.log.push({ sql, args });
        return self.execute(sql, args);
      },
      all(...args: any[]) {
        self.log.push({ sql, args });
        return self.execute(sql, args);
      }
    };
  }

  execute(sql: string, args: any[] = []): any[] {
    const trimmed = sql.trim();

    if (trimmed === 'BEGIN' || trimmed === 'COMMIT' || trimmed === 'ROLLBACK') {
      return [];
    }

    // sqlite_master existence check
    const masterMatch = /^SELECT name FROM sqlite_master WHERE type='table' AND name = \?$/i.exec(trimmed);
    if (masterMatch) {
      const name = String(args[0]);
      return this.tables.has(name) ? [{ name }] : [];
    }

    // PRAGMA table_info("table")
    const pragmaMatch = /^PRAGMA table_info\("([^"]+)"\)$/i.exec(trimmed);
    if (pragmaMatch) {
      const name = pragmaMatch[1]!;
      const t = this.tables.get(name);
      return t ? t.columns.map(c => ({ ...c })) : [];
    }

    // CREATE TABLE "table" (...)
    const createMatch = /^CREATE TABLE "([^"]+)" \(([\s\S]+)\)$/i.exec(trimmed);
    if (createMatch) {
      const name = createMatch[1]!;
      const colsBlock = createMatch[2]!;
      const cols = colsBlock.split(/,(?![^()]*\))/).map(line => {
        const match = /^"([^"]+)"\s+(\S+)/.exec(line.trim());
        return { name: match ? match[1] : line.trim(), type: match ? match[2] : 'TEXT' };
      });
      this.tables.set(name, { columns: cols, rows: [], nextId: 1 });
      return [];
    }

    // ALTER TABLE "table" ADD COLUMN ...
    const alterMatch = /^ALTER TABLE "([^"]+)" ADD COLUMN "([^"]+)"\s*(\S+)?/i.exec(trimmed);
    if (alterMatch) {
      const name = alterMatch[1]!;
      const colName = alterMatch[2]!;
      const colType = alterMatch[3] || 'TEXT';
      const t = this.tables.get(name);
      if (t) t.columns.push({ name: colName, type: colType });
      return [];
    }

    // CREATE INDEX ...
    const indexMatch = /^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS "([^"]+)" ON "([^"]+)" \(([\s\S]+)\)$/i.exec(trimmed);
    if (indexMatch) {
      return [];
    }

    // SELECT * FROM "table" WHERE id = ? LIMIT 1
    const selectOneMatch = /^SELECT \* FROM "([^"]+)" WHERE id = \? LIMIT 1$/i.exec(trimmed);
    if (selectOneMatch) {
      const name = selectOneMatch[1]!;
      const t = this.tables.get(name);
      if (!t) return [];
      const row = t.rows.find(r => r.id === args[0]);
      return row ? [row] : [];
    }

    // SELECT * FROM "table" [WHERE ...] [ORDER BY ...] [LIMIT ...] [OFFSET ...]
    const selectMatch = /^SELECT \* FROM "([^"]+)"(?: WHERE ([\s\S]+?))?(?: ORDER BY "([^"]+)" (ASC|DESC))?(?: LIMIT (\d+))?(?: OFFSET (\d+))?$/i.exec(trimmed);
    if (selectMatch) {
      const name = selectMatch[1]!;
      const t = this.tables.get(name);
      if (!t) return [];
      let rows = [...t.rows];
      const whereClause = selectMatch[2];
      if (whereClause) {
        let p = 0;
        const clauses = whereClause.split(/\s+AND\s+/i);
        for (const cl of clauses) {
          if (cl.includes('_deletedAt IS NULL')) {
            rows = rows.filter(r => !r._deletedAt);
          } else if (cl.includes(' = ?')) {
            const col = /"([^"]+)" = \?/.exec(cl)![1]!;
            const val = args[p++];
            rows = rows.filter(r => r[col] === val);
          } else if (cl.includes(' != ?')) {
            const col = /"([^"]+)" != \?/.exec(cl)![1]!;
            const val = args[p++];
            rows = rows.filter(r => r[col] !== val);
          } else if (cl.includes(' >= ?')) {
            const col = /"([^"]+)" >= \?/.exec(cl)![1]!;
            const val = args[p++];
            rows = rows.filter(r => Number(r[col]) >= Number(val));
          } else if (cl.includes(' LIKE ?')) {
            const col = /"([^"]+)" LIKE \?/.exec(cl)![1]!;
            const val = String(args[p++]).replace(/%/g, '');
            rows = rows.filter(r => String(r[col] ?? '').includes(val));
          }
        }
      }

      const orderCol = selectMatch[3];
      const orderDir = selectMatch[4];
      if (orderCol) {
        rows.sort((a, b) => {
          const aVal = a[orderCol];
          const bVal = b[orderCol];
          const res = aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
          return orderDir === 'DESC' ? -res : res;
        });
      }

      const limit = selectMatch[5] ? Number(selectMatch[5]) : undefined;
      const offset = selectMatch[6] ? Number(selectMatch[6]) : 0;
      if (offset) rows = rows.slice(offset);
      if (limit !== undefined) rows = rows.slice(0, limit);

      return rows;
    }

    // INSERT INTO "table" ... VALUES ... ON CONFLICT
    const insertMatch = /^INSERT INTO "([^"]+)" \(([^)]+)\)\s+VALUES \(([^)]+)\)(?:\s+ON CONFLICT.+)?$/i.exec(trimmed);
    if (insertMatch) {
      const name = insertMatch[1]!;
      let t = this.tables.get(name);
      if (!t) {
        this.tables.set(name, { columns: [], rows: [], nextId: 1 });
        t = this.tables.get(name)!;
      }
      const cols = insertMatch[2]!.split(',').map(s => s.trim().replace(/^"|"$/g, ''));
      const row: any = {};
      cols.forEach((c, i) => (row[c] = args[i]));
      if (!row.id) row.id = String(t.nextId++);

      const idx = t.rows.findIndex(r => r.id === row.id);
      if (idx >= 0) {
        t.rows[idx] = { ...t.rows[idx], ...row };
      } else {
        t.rows.push(row);
      }
      return [];
    }

    // DELETE FROM "table" WHERE id = ?
    const deleteMatch = /^DELETE FROM "([^"]+)" WHERE id = \?$/i.exec(trimmed);
    if (deleteMatch) {
      const name = deleteMatch[1]!;
      const t = this.tables.get(name);
      if (t) {
        t.rows = t.rows.filter(r => r.id !== args[0]);
      }
      return [];
    }

    // DELETE FROM "table"
    const clearMatch = /^DELETE FROM "([^"]+)"$/i.exec(trimmed);
    if (clearMatch) {
      const name = clearMatch[1]!;
      const t = this.tables.get(name);
      if (t) t.rows = [];
      return [];
    }

    return [];
  }
}

describe('Pluggable Storage Adapters', () => {
  describe('IndexedDBStorageAdapter', () => {
    let mockDb: any;
    let adapter: IndexedDBStorageAdapter;

    beforeEach(async () => {
      mockDb = new MockIDBDatabase('test-db', 1);
      mockDb.createObjectStore('items', { keyPath: 'id' });
      adapter = new IndexedDBStorageAdapter(mockDb);
      await adapter.connect();
    });

    it('performs CRUD operations on IndexedDB', async () => {
      await adapter.put('items', { id: 'item_1', name: 'Keyboard', price: 99 });
      const record = await adapter.get<{ id: string; name: string }>('items', 'item_1');
      expect(record).toBeDefined();
      expect(record!.name).toBe('Keyboard');

      const all = await adapter.getAll('items');
      expect(all.length).toBe(1);

      await adapter.delete('items', 'item_1');
      const deleted = await adapter.get('items', 'item_1');
      expect(deleted).toBeNull();
    });
  });

  describe('TursoStorageAdapter (Direct Server / SSR Mode)', () => {
    let driver: MockSqliteDriver;
    let adapter: TursoStorageAdapter;

    beforeEach(async () => {
      driver = new MockSqliteDriver();
      adapter = new TursoStorageAdapter({ client: driver as any });
      await adapter.connect();
    });

    it('creates tables and declared indexes via ensureStore', async () => {
      await adapter.ensureStore('tasks', {
        columns: [
          { name: 'title', type: 'string', nullable: false },
          { name: 'priority', type: 'integer', default: 0 }
        ],
        indexes: [
          { name: 'idx_tasks_priority', keyPath: 'priority' }
        ]
      });

      expect(driver.tables.has('tasks')).toBe(true);
      const cols = driver.tables.get('tasks')!.columns;
      expect(cols.some(c => c.name === 'title')).toBe(true);
      expect(cols.some(c => c.name === 'priority')).toBe(true);
    });

    it('handles direct put, get, getAll with queries, delete, and clear', async () => {
      await adapter.ensureStore('tasks');

      // Put
      await adapter.put('tasks', { id: 't1', title: 'Task 1', priority: 1, done: false });
      await adapter.put('tasks', { id: 't2', title: 'Task 2', priority: 5, done: true });

      // Get
      const t1 = await adapter.get<any>('tasks', 't1');
      expect(t1).toBeDefined();
      expect(t1.title).toBe('Task 1');
      expect(t1.priority).toBe(1);

      // GetAll with conditions
      const highPriority = await adapter.getAll<any>('tasks', {
        where: [{ field: 'priority', operator: '>=', value: 2 }]
      });
      expect(highPriority.length).toBe(1);
      expect(highPriority[0].id).toBe('t2');

      // Delete
      await adapter.delete('tasks', 't1');
      expect(await adapter.get('tasks', 't1')).toBeNull();

      // Clear
      await adapter.clear('tasks');
      expect(await adapter.getAll('tasks')).toHaveLength(0);
    });

    it('runs transactions atomically', async () => {
      await adapter.ensureStore('accounts');
      await adapter.put('accounts', { id: 'a1', balance: 100 });

      await adapter.transaction(['accounts'], 'readwrite', async () => {
        await adapter.put('accounts', { id: 'a1', balance: 150 });
      });

      const updated = await adapter.get<any>('accounts', 'a1');
      expect(updated.balance).toBe(150);
    });

    it('runs ActiveRecord models directly against TursoStorageAdapter without IndexedDB', async () => {
      class ServerTask extends ActiveRecord<ServerTask> {
        static tableName = 'server_tasks';
        static columns = {
          title: { type: 'string', nullable: false },
          status: { type: 'string', default: 'active' }
        };
      }

      const db = new Database('ssr_app', { storage: adapter });
      db.registerModel(ServerTask);
      await db.connect();

      // Creates directly via TursoStorageAdapter
      const task = await ServerTask.create({ title: 'Server rendered task' } as any);
      expect(task.id).toBeDefined();
      expect(task.title).toBe('Server rendered task');

      // Queries directly via TursoStorageAdapter
      const allTasks = await ServerTask.where('title', 'like', '%Server%').all();
      expect(allTasks.length).toBe(1);
      expect(allTasks[0].title).toBe('Server rendered task');

      // Update
      await task.update({ title: 'Updated server task' });
      const refetched = await ServerTask.find(task.id!);
      expect(refetched!.title).toBe('Updated server task');

      // Destroy
      await task.destroy();
      const afterDestroy = await ServerTask.find(task.id!);
      expect(afterDestroy).toBeNull();
    });
  });
});
