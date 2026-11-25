import { describe, it, expect, beforeEach } from 'vitest';
import { TursoAdapter } from '../src/adapters/turso-adapter';
import { SQLiteAdapter } from '../src/adapters/sqlite-adapter';
import { SyncEngine } from '../src/sync-engine';
import { MockIDBDatabase } from './mocks/indexeddb';

class MockSqliteMemoryDriver {
  tables = new Map<string, { columns: Array<{ name: string; type: string; notnull: number; pk: number; dflt_value: any }>; rows: any[] }>();

  execute({ sql, args = [] }: { sql: string; args?: unknown[] }) {
    const trimmed = sql.trim();

    if (/^SELECT name FROM sqlite_master WHERE type='table'/i.test(trimmed)) {
      const name = String(args[0]);
      return { rows: this.tables.has(name) ? [{ name }] : [], rowsAffected: 0, columns: ['name'] };
    }

    if (/^PRAGMA table_info/i.test(trimmed)) {
      const m = /^PRAGMA table_info\("?([^"\s]+)"?\)/i.exec(trimmed);
      const name = m![1];
      const t = this.tables.get(name);
      return {
        rows: t ? t.columns.map(c => ({ ...c })) : [],
        rowsAffected: 0,
        columns: ['name', 'type', 'notnull', 'pk', 'dflt_value']
      };
    }

    if (/^CREATE TABLE/i.test(trimmed)) {
      const m = /^CREATE TABLE "?([^"\s(]+)"?\s*\(([\s\S]+)\)$/i.exec(trimmed);
      const name = m![1];
      const colsBlock = m![2];
      const cols = colsBlock.split(/,(?![^()]*\))/).map(line => {
        const lineTrim = line.trim();
        const parts = lineTrim.split(/\s+/);
        const colName = parts[0].replace(/"/g, '');
        const colType = parts[1] || 'TEXT';
        return { name: colName, type: colType, notnull: 0, pk: colName === 'id' ? 1 : 0, dflt_value: null };
      });
      this.tables.set(name, { columns: cols, rows: [] });
      return { rows: [], rowsAffected: 0, columns: [] };
    }

    if (/^SELECT version FROM/i.test(trimmed)) {
      const m = /^SELECT version FROM "?([^"\s]+)"? WHERE id = \?/i.exec(trimmed);
      const name = m![1];
      const t = this.tables.get(name);
      const r = t?.rows.find(x => x.id === args[0]);
      return { rows: r ? [{ version: r.version }] : [], rowsAffected: 0, columns: ['version'] };
    }

    if (/^SELECT \* FROM/i.test(trimmed)) {
      const m = /^SELECT \* FROM "?([^"\s]+)"?/i.exec(trimmed);
      const name = m![1];
      const t = this.tables.get(name);
      return { rows: t ? t.rows.map(r => ({ ...r })) : [], rowsAffected: 0, columns: t ? t.columns.map(c => c.name) : [] };
    }

    if (/^INSERT INTO/i.test(trimmed)) {
      const m = /^INSERT INTO "?([^"\s(]+)"?\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)(.*)$/i.exec(trimmed);
      const name = m![1];
      const colNames = m![2].split(',').map(s => s.trim().replace(/"/g, ''));
      const t = this.tables.get(name);
      if (!t) throw new Error(`no table ${name}`);

      const row: Record<string, any> = {};
      colNames.forEach((c, i) => {
        row[c] = args[i];
      });

      const idx = t.rows.findIndex(r => r.id === row.id);
      if (idx >= 0) {
        t.rows[idx] = { ...t.rows[idx], ...row };
      } else {
        t.rows.push(row);
      }
      return { rows: [], rowsAffected: 1, columns: [] };
    }

    return { rows: [], rowsAffected: 0, columns: [] };
  }

  prepare(sql: string) {
    const driver = this;
    return {
      run(...args: any[]) {
        const res = driver.execute({ sql, args });
        return { changes: res.rowsAffected, lastInsertRowid: 1 };
      },
      all(...args: any[]) {
        const res = driver.execute({ sql, args });
        return res.rows;
      },
      get(...args: any[]) {
        const res = driver.execute({ sql, args });
        return res.rows[0];
      }
    };
  }

  close() {}
}

describe('JSON / Array Serialization for SQLite/Turso', () => {
  describe('TursoAdapter serialization', () => {
    it('serializes nested objects and arrays on push and deserializes on pull', async () => {
      const driver = new MockSqliteMemoryDriver();
      const adapter = new TursoAdapter();
      await adapter.connect({ client: driver as any });

      // Define table with JSON and TEXT columns
      await adapter.ensureTable('items', [
        { name: 'id', type: 'string', primaryKey: true, nullable: false },
        { name: 'title', type: 'string', nullable: false },
        { name: 'tags', type: 'json', nullable: true },
        { name: 'metadata', type: 'json', nullable: true },
        { name: 'active', type: 'boolean', nullable: true },
        { name: 'notes', type: 'string', nullable: true } // plain TEXT
      ]);

      const originalRecord = {
        id: 'item-1',
        title: '{"looks_like_json": true}', // Plain string that looks like JSON in TEXT column
        tags: ['work', 'urgent', 42],
        metadata: {
          author: { name: 'Alice', id: 101 },
          nested: [true, 'mixed', { sub: 99 }]
        },
        active: true,
        notes: null,
        _version: 1
      };

      await adapter.push([originalRecord as any], { table: 'items' });

      // Check how driver stored it internally: tags and metadata must be stringified JSON
      const stored = driver.tables.get('items')!.rows[0];
      expect(typeof stored.tags).toBe('string');
      expect(JSON.parse(stored.tags)).toEqual(['work', 'urgent', 42]);
      expect(typeof stored.metadata).toBe('string');
      expect(JSON.parse(stored.metadata)).toEqual({
        author: { name: 'Alice', id: 101 },
        nested: [true, 'mixed', { sub: 99 }]
      });
      // Boolean stored as 1
      expect(stored.active).toBe(1);

      // Now pull through adapter: must deserialize cleanly
      const pulled = await adapter.pull<any>({ table: 'items' });
      expect(pulled.length).toBe(1);
      const result = pulled[0];

      // Nested object round-trips identically
      expect(result.metadata).toEqual(originalRecord.metadata);
      // Array round-trips identically
      expect(result.tags).toEqual(originalRecord.tags);
      // Plain string in TEXT column was NOT corrupted or parsed
      expect(result.title).toBe('{"looks_like_json": true}');
      // Null value preserved
      expect(result.notes).toBeNull();
      // Boolean converted back cleanly
      expect(result.active).toBe(true);
    });
  });

  describe('SQLiteAdapter serialization', () => {
    it('serializes nested objects and arrays on push and deserializes on pull', async () => {
      const driver = new MockSqliteMemoryDriver();
      const adapter = new SQLiteAdapter();
      await adapter.connect({ client: driver as any });

      await adapter.ensureTable('configs', [
        { name: 'id', type: 'string', primaryKey: true, nullable: false },
        { name: 'name', type: 'string', nullable: false },
        { name: 'payload', type: 'json', nullable: true },
        { name: 'flags', type: 'json', nullable: true },
        { name: 'enabled', type: 'boolean', nullable: true }
      ]);

      const record = {
        id: 'cfg-1',
        name: 'Main Config',
        payload: { deep: { nesting: [1, 2, 3] } },
        flags: ['dev', 'canary'],
        enabled: true,
        _version: 1
      };

      await adapter.push([record as any], { table: 'configs' });

      const pulled = await adapter.pull<any>({ table: 'configs' });
      expect(pulled.length).toBe(1);
      expect(pulled[0].payload).toEqual(record.payload);
      expect(pulled[0].flags).toEqual(record.flags);
      expect(pulled[0].enabled).toBe(true);
    });
  });

  describe('SyncEngine column inference for JSON / Arrays', () => {
    it('infers json type for arrays and objects in deriveColumns', async () => {
      const mockDb = new MockIDBDatabase();
      mockDb.createObjectStore('data', { keyPath: 'id' });
      mockDb.createObjectStore('__sync_meta', { keyPath: 'table' });
      const changeStore = mockDb.createObjectStore('__sync_changes', { keyPath: 'id', autoIncrement: true });
      changeStore.createIndex('table', 'table', { unique: false });
      changeStore.createIndex('synced', 'synced', { unique: false });

      const engine = new SyncEngine();
      engine.setDatabase(mockDb);

      let capturedColumns: any[] = [];
      const fakeAdapter: any = {
        isConnected: () => true,
        ensureTable: async (_table: string, cols: any[]) => {
          capturedColumns = cols;
        },
        push: async () => ({ pushed: 1, conflicts: 0, errors: [] }),
        pull: async () => [],
        state: { lastPullAt: null }
      };

      // Stage change with object and array
      const tx = mockDb.transaction(['__sync_changes'], 'readwrite');
      tx.objectStore('__sync_changes').add({
        table: 'data',
        recordId: '1',
        action: 'create',
        data: {
          id: '1',
          name: 'Item 1',
          tags: ['a', 'b'],
          details: { foo: 'bar' },
          count: 5,
          active: true
        },
        timestamp: new Date().toISOString(),
        synced: false
      });

      await engine.sync('data', fakeAdapter);

      const tagsCol = capturedColumns.find(c => c.name === 'tags');
      const detailsCol = capturedColumns.find(c => c.name === 'details');
      const countCol = capturedColumns.find(c => c.name === 'count');
      const activeCol = capturedColumns.find(c => c.name === 'active');

      expect(tagsCol.type).toBe('json');
      expect(detailsCol.type).toBe('json');
      expect(countCol.type).toBe('integer');
      expect(activeCol.type).toBe('boolean');
    });
  });
});
