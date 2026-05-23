import { describe, it, expect, beforeEach } from 'vitest';
import { TursoAdapter, TursoClient, TursoStatement } from '../src/adapters/turso-adapter';
import { BaseAdapter, SyncStatus } from '../src/sync-adapter';

// ------------------------------------------------------------------
// Tiny in-memory SQLite-ish mock that records SQL + responds to a few
// well-known queries (sqlite_master, PRAGMA table_info, SELECT/INSERT).
// Just enough fidelity for unit tests — not a real query engine.
// ------------------------------------------------------------------

interface FakeTable {
  columns: { name: string; type: string; notnull: number; pk: number; dflt_value: unknown }[];
  rows: Record<string, unknown>[];
  nextId: number;
}

class MockSqliteClient implements TursoClient {
  tables: Map<string, FakeTable> = new Map();
  /** Every SQL call recorded as { sql, params }. */
  log: { sql: string; params: unknown[] }[] = [];

  prepare(sql: string): TursoStatement {
    const self = this;
    return {
      run(...params: unknown[]) {
        self.log.push({ sql, params });
        self.execute(sql, params);
        return { changes: 1 };
      },
      all(...params: unknown[]) {
        self.log.push({ sql, params });
        return self.execute(sql, params);
      }
    };
  }

  private execute(sql: string, params: unknown[]): any[] {
    const trimmed = sql.trim();

    // sqlite_master existence check
    const masterMatch = /^SELECT name FROM sqlite_master WHERE type='table' AND name = \?$/i.exec(trimmed);
    if (masterMatch) {
      const name = String(params[0]);
      return this.tables.has(name) ? [{ name }] : [];
    }

    // PRAGMA table_info("foo")
    const pragmaMatch = /^PRAGMA table_info\("([^"]+)"\)$/i.exec(trimmed);
    if (pragmaMatch) {
      const name = pragmaMatch[1]!;
      const t = this.tables.get(name);
      return t ? t.columns.map(c => ({ ...c })) : [];
    }

    // CREATE TABLE "foo" (...)
    const createMatch = /^CREATE TABLE "([^"]+)" \(([\s\S]+)\)$/i.exec(trimmed);
    if (createMatch) {
      const name = createMatch[1]!;
      const colsBlock = createMatch[2]!;
      const columns = colsBlock.split(/,(?![^()]*\))/).map(line => this.parseColumn(line.trim()));
      this.tables.set(name, { columns, rows: [], nextId: 1 });
      return [];
    }

    // ALTER TABLE "foo" ADD COLUMN "bar" TEXT ...
    const alterMatch = /^ALTER TABLE "([^"]+)" ADD COLUMN (.+)$/i.exec(trimmed);
    if (alterMatch) {
      const t = this.tables.get(alterMatch[1]!);
      if (t) t.columns.push(this.parseColumn(alterMatch[2]!));
      return [];
    }

    // SELECT version FROM "foo" WHERE id = ?
    const selectVersion = /^SELECT version FROM "([^"]+)" WHERE id = \?$/i.exec(trimmed);
    if (selectVersion) {
      const t = this.tables.get(selectVersion[1]!);
      if (!t) return [];
      const row = t.rows.find(r => r.id === params[0]);
      return row ? [{ version: row.version }] : [];
    }

    // SELECT * FROM "foo" WHERE ... ORDER BY id ASC [LIMIT N] [OFFSET N]
    const selectMatch = /^SELECT \* FROM "([^"]+)"(?: WHERE ([\s\S]+?))? ORDER BY id ASC(?: LIMIT \d+)?(?: OFFSET \d+)?$/i.exec(trimmed);
    if (selectMatch) {
      const t = this.tables.get(selectMatch[1]!);
      if (!t) return [];
      let rows = [...t.rows];
      const where = selectMatch[2];
      if (where) {
        const clauses = where.split(/\s+AND\s+/i);
        let p = 0;
        for (const clause of clauses) {
          if (/^updatedAt > \?$/i.test(clause)) {
            const since = String(params[p++]);
            rows = rows.filter(r => String(r.updatedAt ?? '') > since);
          } else if (/^"([^"]+)" = \?$/i.test(clause)) {
            const col = /^"([^"]+)" = \?$/i.exec(clause)![1]!;
            const val = params[p++];
            rows = rows.filter(r => r[col] === val);
          } else if (/^deleted_at IS NULL$/i.test(clause)) {
            rows = rows.filter(r => r.deleted_at == null);
          }
        }
      }
      return rows.sort((a, b) => Number(a.id) - Number(b.id));
    }

    // INSERT INTO "foo" (...) VALUES (...) [ON CONFLICT(id) DO UPDATE SET ...]
    const insertMatch = /^INSERT INTO "([^"]+)" \(([^)]+)\) VALUES \(([^)]+)\)( ON CONFLICT\(id\) DO UPDATE SET .+)?$/i.exec(trimmed);
    if (insertMatch) {
      const t = this.tables.get(insertMatch[1]!);
      if (!t) throw new Error(`no such table: ${insertMatch[1]}`);
      const cols = insertMatch[2]!.split(',').map(s => s.trim().replace(/^"|"$/g, ''));
      const row: Record<string, unknown> = {};
      cols.forEach((c, i) => (row[c] = params[i]));
      const upsert = !!insertMatch[4];
      if (upsert && row.id !== undefined) {
        const idx = t.rows.findIndex(r => r.id === row.id);
        if (idx >= 0) {
          t.rows[idx] = { ...t.rows[idx], ...row };
          return [];
        }
      }
      if (row.id === undefined) row.id = t.nextId++;
      t.rows.push(row);
      return [];
    }

    throw new Error(`Mock SQLite: unsupported SQL: ${sql}`);
  }

  private parseColumn(decl: string): FakeTable['columns'][number] {
    const nameMatch = /^"([^"]+)"\s+(\S+)/.exec(decl.trim());
    if (!nameMatch) throw new Error(`bad column decl: ${decl}`);
    return {
      name: nameMatch[1]!,
      type: nameMatch[2]!,
      notnull: /\bNOT NULL\b/i.test(decl) ? 1 : 0,
      pk: /\bPRIMARY KEY\b/i.test(decl) ? 1 : 0,
      dflt_value: null
    };
  }
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe('TursoAdapter', () => {
  let client: MockSqliteClient;
  let adapter: TursoAdapter;

  beforeEach(async () => {
    client = new MockSqliteClient();
    adapter = new TursoAdapter();
    await adapter.connect({ client });
  });

  describe('connect / disconnect', () => {
    it('extends BaseAdapter', () => {
      expect(adapter).toBeInstanceOf(BaseAdapter);
    });

    it('throws if no client is provided', async () => {
      const bare = new TursoAdapter();
      await expect(bare.connect({} as any)).rejects.toThrow(/requires a connected client/i);
    });

    it('reports IDLE status after connect', () => {
      expect(adapter.state.status).toBe(SyncStatus.IDLE);
      expect(adapter.isConnected()).toBe(true);
    });

    it('disconnect clears connected state', async () => {
      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });
  });

  describe('ensureTable', () => {
    it('creates a new table with declared columns when missing', async () => {
      await adapter.ensureTable('tasks', [
        { name: 'id', type: 'integer', primaryKey: true, autoIncrement: true, nullable: false },
        { name: 'title', type: 'string', nullable: false },
        { name: 'priority', type: 'integer', default: 0, nullable: true }
      ]);

      const create = client.log.find(c => /^CREATE TABLE/i.test(c.sql));
      expect(create).toBeDefined();
      expect(create!.sql).toMatch(/"id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL/);
      expect(create!.sql).toMatch(/"title" TEXT NOT NULL/);
      expect(create!.sql).toMatch(/"priority" INTEGER DEFAULT 0/);
      expect(client.tables.has('tasks')).toBe(true);
    });

    it('adds missing columns to an existing table via ALTER TABLE', async () => {
      await adapter.ensureTable('tasks', [
        { name: 'id', type: 'integer', primaryKey: true, autoIncrement: true, nullable: false },
        { name: 'title', type: 'string', nullable: false }
      ]);
      client.log.length = 0;

      await adapter.ensureTable('tasks', [
        { name: 'id', type: 'integer', primaryKey: true, autoIncrement: true, nullable: false },
        { name: 'title', type: 'string', nullable: false },
        { name: 'status', type: 'string', nullable: true }
      ]);

      const alter = client.log.find(c => /^ALTER TABLE/i.test(c.sql));
      expect(alter).toBeDefined();
      expect(alter!.sql).toMatch(/ADD COLUMN "status" TEXT/);
      expect(client.tables.get('tasks')!.columns.some(c => c.name === 'status')).toBe(true);
    });

    it('does not re-ALTER columns that already exist', async () => {
      await adapter.ensureTable('tasks', [
        { name: 'id', type: 'integer', primaryKey: true, autoIncrement: true, nullable: false },
        { name: 'title', type: 'string', nullable: false }
      ]);
      client.log.length = 0;

      await adapter.ensureTable('tasks', [
        { name: 'id', type: 'integer', primaryKey: true, autoIncrement: true, nullable: false },
        { name: 'title', type: 'string', nullable: false }
      ]);

      const alters = client.log.filter(c => /^ALTER TABLE/i.test(c.sql));
      expect(alters).toHaveLength(0);
    });

    it('rejects identifiers containing double quotes (injection guard)', async () => {
      await expect(
        adapter.ensureTable('evil"; DROP TABLE tasks;--', [
          { name: 'id', type: 'integer', nullable: false }
        ])
      ).rejects.toThrow(/Invalid SQL identifier/i);
    });
  });

  describe('push', () => {
    async function setupTasks(): Promise<void> {
      await adapter.ensureTable('tasks', [
        { name: 'id', type: 'integer', primaryKey: true, autoIncrement: true, nullable: false },
        { name: 'updatedAt', type: 'datetime', nullable: false },
        { name: 'version', type: 'integer', nullable: false, default: 1 },
        { name: 'deleted_at', type: 'datetime', nullable: true },
        { name: 'owner_id', type: 'string', nullable: true, default: 'demo' },
        { name: 'title', type: 'string', nullable: false },
        { name: 'status', type: 'string', nullable: true, default: 'pending' }
      ]);
    }

    it('inserts a new record translating wire fields (_version, _deletedAt) to SQL columns', async () => {
      await setupTasks();
      const records = [
        { title: 'Buy milk', status: 'pending', _version: 1, _deletedAt: null, owner_id: 'alice' }
      ] as any;

      const result = await adapter.push(records, { table: 'tasks' });
      expect(result.pushed).toBe(1);
      expect(result.errors).toHaveLength(0);

      const row = client.tables.get('tasks')!.rows[0]!;
      expect(row.title).toBe('Buy milk');
      expect(row.status).toBe('pending');
      expect(row.version).toBe(1);
      expect(row.deleted_at).toBeNull();
      expect(row.owner_id).toBe('alice');
    });

    it('upserts an existing row by id (ON CONFLICT DO UPDATE)', async () => {
      await setupTasks();
      const t1 = client.tables.get('tasks')!;
      t1.rows.push({
        id: 1,
        title: 'old',
        status: 'pending',
        updatedAt: '2024-01-01T00:00:00Z',
        version: 1,
        deleted_at: null,
        owner_id: 'alice'
      });

      const records = [
        { id: 1, title: 'new', status: 'done', _version: 2, _deletedAt: null, owner_id: 'alice', updatedAt: '2024-01-02T00:00:00Z' }
      ] as any;

      const result = await adapter.push(records, { table: 'tasks' });
      expect(result.pushed).toBe(1);
      const row = client.tables.get('tasks')!.rows[0]!;
      expect(row.title).toBe('new');
      expect(row.status).toBe('done');
      expect(row.version).toBe(2);
    });

    it('rejects records when server version is newer (optimistic concurrency)', async () => {
      await setupTasks();
      client.tables.get('tasks')!.rows.push({
        id: 1,
        title: 'server-version',
        status: 'pending',
        updatedAt: '2024-01-02T00:00:00Z',
        version: 5,
        deleted_at: null,
        owner_id: 'alice'
      });

      const records = [
        { id: 1, title: 'stale-client', _version: 2, _deletedAt: null, owner_id: 'alice' }
      ] as any;

      const result = await adapter.push(records, { table: 'tasks' });
      expect(result.pushed).toBe(0);
      expect(result.conflicts).toBe(1);
      expect(result.errors[0]!.error).toMatch(/version_conflict/);
      expect(client.tables.get('tasks')!.rows[0]!.title).toBe('server-version');
    });

    it('writes _deletedAt as a tombstone in the deleted_at column', async () => {
      await setupTasks();
      const records = [
        {
          id: 1,
          title: 'gone',
          _version: 2,
          _deletedAt: '2024-01-03T00:00:00Z',
          owner_id: 'alice'
        }
      ] as any;

      const result = await adapter.push(records, { table: 'tasks' });
      expect(result.pushed).toBe(1);
      expect(client.tables.get('tasks')!.rows[0]!.deleted_at).toBe('2024-01-03T00:00:00Z');
    });

    it('throws when records have no tableName and no options.table', async () => {
      const plain = [{ id: 1, title: 'x' }] as any;
      await expect(adapter.push(plain)).rejects.toThrow(/Cannot push records without tableName/);
    });

    it('returns an empty result when called with no records', async () => {
      const result = await adapter.push([] as any);
      expect(result.pushed).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('pull', () => {
    async function seedTasks(): Promise<void> {
      await adapter.ensureTable('tasks', [
        { name: 'id', type: 'integer', primaryKey: true, autoIncrement: true, nullable: false },
        { name: 'updatedAt', type: 'datetime', nullable: false },
        { name: 'version', type: 'integer', nullable: false },
        { name: 'deleted_at', type: 'datetime', nullable: true },
        { name: 'owner_id', type: 'string', nullable: true },
        { name: 'title', type: 'string', nullable: false }
      ]);
      const t = client.tables.get('tasks')!;
      t.rows.push(
        { id: 1, title: 'A', updatedAt: '2024-01-01T00:00:00Z', version: 1, deleted_at: null, owner_id: 'alice' },
        { id: 2, title: 'B', updatedAt: '2024-01-02T00:00:00Z', version: 1, deleted_at: null, owner_id: 'bob' },
        { id: 3, title: 'C', updatedAt: '2024-01-03T00:00:00Z', version: 2, deleted_at: '2024-01-03T00:00:00Z', owner_id: 'alice' }
      );
    }

    it('maps SQL columns to wire format (version -> _version, deleted_at -> _deletedAt)', async () => {
      await seedTasks();
      const rows = await adapter.pull({ table: 'tasks', includeDeleted: true });
      expect(rows).toHaveLength(3);
      const r3 = rows.find(r => (r as any).id === 3) as any;
      expect(r3._version).toBe(2);
      expect(r3._deletedAt).toBe('2024-01-03T00:00:00Z');
    });

    it('excludes soft-deleted rows when includeDeleted is false/unset', async () => {
      await seedTasks();
      const rows = await adapter.pull({ table: 'tasks' });
      expect(rows).toHaveLength(2);
      expect((rows as any[]).every(r => r._deletedAt == null)).toBe(true);
    });

    it('filters by owner_id when query.where.owner_id is set', async () => {
      await seedTasks();
      const rows = await adapter.pull({ table: 'tasks', where: { owner_id: 'alice' }, includeDeleted: true });
      expect((rows as any[]).every(r => r.owner_id === 'alice')).toBe(true);
      expect(rows).toHaveLength(2);
    });

    it('filters by since cursor (updatedAt > since)', async () => {
      await seedTasks();
      const rows = await adapter.pull({ table: 'tasks', since: new Date('2024-01-01T12:00:00Z') });
      // Only id=2 (id=3 is excluded by deleted_at filter)
      expect(rows).toHaveLength(1);
      expect((rows[0] as any).id).toBe(2);
    });
  });

  describe('getRemoteSchema', () => {
    it('returns column definitions read from PRAGMA table_info', async () => {
      await adapter.ensureTable('tasks', [
        { name: 'id', type: 'integer', primaryKey: true, autoIncrement: true, nullable: false },
        { name: 'title', type: 'string', nullable: false },
        { name: 'priority', type: 'integer', default: 0, nullable: true }
      ]);

      const schema = await adapter.getRemoteSchema('tasks');
      expect(schema.name).toBe('tasks');
      const byName = (n: string) => schema.columns.find(c => c.name === n)!;
      expect(byName('id').primaryKey).toBe(true);
      expect(byName('title').nullable).toBe(false);
      expect(byName('priority').type).toBe('integer');
    });
  });
});
