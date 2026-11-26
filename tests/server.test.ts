import { describe, it, expect, vi } from 'vitest';
import { createSyncHandler, isValidIdentifier, sanitizeRecord } from '../src/server';
import { BaseAdapter, SyncResult, SyncStatus, TableSchema } from '../src/sync-adapter';

class MockMemoryAdapter extends BaseAdapter {
  tables = new Map<string, any[]>();
  schemas = new Map<string, any>();
  lastPullQuery: any = null;
  lastPushedRecords: any[] = [];
  lastPushedTable: string | null = null;

  async connect(): Promise<void> {
    this.connected = true;
    this.updateState({ status: SyncStatus.IDLE });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async pull<T>(query: any): Promise<T[]> {
    this.lastPullQuery = query;
    const all = this.tables.get(query.table) || [];
    let rows = [...all];
    if (query.where?.owner_id) {
      rows = rows.filter(r => r.owner_id === query.where.owner_id);
    }
    if (query.limit) {
      rows = rows.slice(0, query.limit);
    }
    return rows as T[];
  }

  async push<T>(records: T[], options?: any): Promise<SyncResult> {
    this.lastPushedRecords = records as any[];
    this.lastPushedTable = options?.table;
    const table = options?.table;
    if (!this.tables.has(table)) {
      this.tables.set(table, []);
    }
    const current = this.tables.get(table)!;
    for (const r of records as any[]) {
      const idx = current.findIndex(x => x.id === r.id);
      if (idx >= 0) {
        current[idx] = { ...current[idx], ...r };
      } else {
        current.push(r);
      }
    }
    return {
      pushed: records.length,
      pulled: 0,
      conflicts: 0,
      errors: [],
      timestamp: new Date()
    };
  }

  async getRemoteSchema(table: string): Promise<TableSchema> {
    return this.schemas.get(table) || { name: table, columns: [], indexes: [] };
  }

  async ensureTable(table: string, columns: any[]): Promise<void> {
    this.schemas.set(table, { name: table, columns, indexes: [] });
  }

  async applyMigration(): Promise<void> {}
}

describe('Web-Standard createSyncHandler', () => {
  it('exports handler and HTTP method helpers', async () => {
    const adapter = new MockMemoryAdapter();
    await adapter.connect();
    const sync = createSyncHandler({ adapter, allowUnauthenticatedDevMode: true });

    expect(typeof sync.handler).toBe('function');
    expect(typeof sync.GET).toBe('function');
    expect(typeof sync.POST).toBe('function');
    expect(typeof sync.DELETE).toBe('function');
    expect(typeof sync.OPTIONS).toBe('function');
  });

  describe('Health check', () => {
    it('returns 200 with serverTime on GET /health', async () => {
      const adapter = new MockMemoryAdapter();
      await adapter.connect();
      const { GET } = createSyncHandler({ adapter, allowUnauthenticatedDevMode: false });

      const req = new Request('http://localhost/health');
      const res = await GET(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(typeof data.serverTime).toBe('string');
    });
  });

  describe('CORS and preflight', () => {
    it('handles OPTIONS preflight with 204 and CORS headers', async () => {
      const adapter = new MockMemoryAdapter();
      await adapter.connect();
      const { OPTIONS } = createSyncHandler({ adapter });

      const req = new Request('http://localhost/tasks', {
        method: 'OPTIONS',
        headers: { Origin: 'https://example.com' }
      });
      const res = await OPTIONS(req);
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
      expect(res.headers.get('Access-Control-Expose-Headers')).toContain('X-Server-Time');
    });

    it('respects custom CORS credentials and allowed origins', async () => {
      const adapter = new MockMemoryAdapter();
      await adapter.connect();
      const { handler } = createSyncHandler({
        adapter,
        cors: {
          origin: ['https://myapp.com'],
          credentials: true
        },
        allowUnauthenticatedDevMode: true
      });

      const req = new Request('http://localhost/health', {
        headers: { Origin: 'https://myapp.com' }
      });
      const res = await handler(req);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://myapp.com');
      expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    });
  });

  describe('Authentication & Tenant Isolation', () => {
    it('returns 401 Unauthorized when unauthenticated without dev mode', async () => {
      const adapter = new MockMemoryAdapter();
      await adapter.connect();
      const { handler } = createSyncHandler({
        adapter,
        allowUnauthenticatedDevMode: false,
        getSessionUser: () => null
      });

      const req = new Request('http://localhost/tasks');
      const res = await handler(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Unauthorized');
    });

    it('authenticates via getSessionUser returning a string or { userId }', async () => {
      const adapter = new MockMemoryAdapter();
      await adapter.connect();
      adapter.tables.set('tasks', [{ id: 't1', owner_id: 'user_123', title: 'Test' }]);

      const { handler } = createSyncHandler({
        adapter,
        getSessionUser: (req) => {
          const auth = req.headers.get('Authorization');
          return auth === 'Bearer token123' ? { userId: 'user_123' } : null;
        }
      });

      const req = new Request('http://localhost/tasks', {
        headers: { Authorization: 'Bearer token123' }
      });
      const res = await handler(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.records.length).toBe(1);
      expect(data.records[0].id).toBe('t1');
    });

    it('anti-spoofing on pull: completely ignores client ?owner_id= parameter', async () => {
      const adapter = new MockMemoryAdapter();
      await adapter.connect();
      adapter.tables.set('tasks', [
        { id: 't1', owner_id: 'alice', title: 'Alice Task' },
        { id: 't2', owner_id: 'bob', title: 'Bob Task' }
      ]);

      const { handler } = createSyncHandler({
        adapter,
        getSessionUser: () => 'bob' // Authenticated as Bob
      });

      // Bob tries to query ?owner_id=alice
      const req = new Request('http://localhost/tasks?owner_id=alice');
      const res = await handler(req);
      expect(res.status).toBe(200);

      // Adapter query must be scoped to 'bob'
      expect(adapter.lastPullQuery.where.owner_id).toBe('bob');
      const data = await res.json();
      expect(data.records.length).toBe(1);
      expect(data.records[0].id).toBe('t2');
      expect(data.records[0].owner_id).toBe('bob');
    });

    it('anti-spoofing on push: overwrites any client-supplied owner_id in payload', async () => {
      const adapter = new MockMemoryAdapter();
      await adapter.connect();

      const { handler } = createSyncHandler({
        adapter,
        getSessionUser: () => 'charlie'
      });

      const req = new Request('http://localhost/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          { id: 't-spoofed', title: 'Hacked', owner_id: 'admin_victim' }
        ])
      });

      const res = await handler(req);
      expect(res.status).toBe(200);

      // The record passed to adapter must have owner_id overwritten to 'charlie'
      expect(adapter.lastPushedRecords[0].owner_id).toBe('charlie');
      expect(adapter.tables.get('tasks')![0].owner_id).toBe('charlie');
    });

    it('anti-spoofing on delete: sets owner_id from authenticated session on soft delete tombstone', async () => {
      const adapter = new MockMemoryAdapter();
      await adapter.connect();

      const { handler } = createSyncHandler({
        adapter,
        getSessionUser: () => 'dave'
      });

      const req = new Request('http://localhost/tasks/task-99', {
        method: 'DELETE'
      });
      const res = await handler(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.deleted).toBe(true);

      expect(adapter.lastPushedRecords[0].id).toBe('task-99');
      expect(adapter.lastPushedRecords[0].owner_id).toBe('dave');
      expect(typeof adapter.lastPushedRecords[0]._deletedAt).toBe('string');
    });
  });

  describe('Security & Prototype Pollution Prevention', () => {
    it('validates table identifiers and rejects SQL injection & path traversal', async () => {
      const adapter = new MockMemoryAdapter();
      await adapter.connect();
      const { handler } = createSyncHandler({ adapter, allowUnauthenticatedDevMode: true });

      const badTables = [
        'tasks; DROP TABLE tasks;--',
        '../etc/passwd',
        'table name with spaces',
        'table-with-dashes',
        '123startsWithNumber',
        '__proto__',
        'constructor',
        'prototype'
      ];

      for (const table of badTables) {
        const req = new Request(`http://localhost/${encodeURIComponent(table)}`);
        const res = await handler(req);
        expect(res.status).toBe(400);
      }
    });

    it('sanitizes records and ignores prototype pollution keys', () => {
      const dirty = {
        id: '1',
        title: 'Safe',
        __proto__: { evil: true },
        constructor: { evil: true },
        prototype: { evil: true }
      };

      const clean = sanitizeRecord(dirty);
      expect(clean.id).toBe('1');
      expect(clean.title).toBe('Safe');
      expect(Object.prototype.hasOwnProperty.call(clean, '__proto__')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(clean, 'constructor')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(clean, 'prototype')).toBe(false);
    });

    it('never leaks raw stack traces in 500 error responses', async () => {
      const adapter = new MockMemoryAdapter();
      await adapter.connect();
      vi.spyOn(adapter, 'pull').mockRejectedValue(new Error('Sensitive DB connection failed\n    at SecretDatabase.connect (/internal/path/file.ts:123)'));

      const { handler } = createSyncHandler({ adapter, allowUnauthenticatedDevMode: true });

      const req = new Request('http://localhost/tasks');
      const res = await handler(req);
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe('Sensitive DB connection failed');
      expect(JSON.stringify(data)).not.toContain('/internal/path/file.ts');
    });
  });

  describe('Configurable basePath', () => {
    it('strips configured basePath prefix', async () => {
      const adapter = new MockMemoryAdapter();
      await adapter.connect();
      adapter.tables.set('notes', [{ id: 'n1', owner_id: 'demo', content: 'Hello' }]);

      const { handler } = createSyncHandler({
        adapter,
        basePath: '/api/v1/sync',
        allowUnauthenticatedDevMode: true
      });

      const req = new Request('http://localhost/api/v1/sync/notes');
      const res = await handler(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.records.length).toBe(1);
      expect(data.records[0].id).toBe('n1');
    });
  });

  describe('Schema endpoints', () => {
    it('supports POST /schema to ensure tables', async () => {
      const adapter = new MockMemoryAdapter();
      await adapter.connect();

      const { handler } = createSyncHandler({
        adapter,
        allowUnauthenticatedDevMode: true
      });

      const req = new Request('http://localhost/schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'projects',
          columns: [
            { name: 'name', type: 'string', nullable: false },
            { name: 'budget', type: 'integer', nullable: true }
          ]
        })
      });

      const res = await handler(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ensured).toBe(true);
      expect(adapter.schemas.has('projects')).toBe(true);
    });

    it('supports GET /schema/:table', async () => {
      const adapter = new MockMemoryAdapter();
      await adapter.connect();
      adapter.schemas.set('items', { name: 'items', columns: [{ name: 'title', type: 'string' }] });

      const { handler } = createSyncHandler({
        adapter,
        allowUnauthenticatedDevMode: true
      });

      const req = new Request('http://localhost/schema/items');
      const res = await handler(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.name).toBe('items');
      expect(data.columns.length).toBe(1);
    });
  });
});
