import { describe, it, expect, vi } from 'vitest';
import { SQLiteAdapter } from '../src/adapters/sqlite-adapter';
import { BaseAdapter, SyncStatus } from '../src/sync-adapter';

describe('SQLiteAdapter (HTTP mode)', () => {
  async function makeHttpAdapter(): Promise<SQLiteAdapter> {
    const adapter = new SQLiteAdapter();
    await adapter.connect({ url: 'http://localhost:3001', endpointPattern: '/{table}' });
    return adapter;
  }

  describe('connect', () => {
    it('extends BaseAdapter', async () => {
      const adapter = await makeHttpAdapter();
      expect(adapter).toBeInstanceOf(BaseAdapter);
    });

    it('reports IDLE after connect in HTTP mode', async () => {
      const adapter = await makeHttpAdapter();
      expect(adapter.state.status).toBe(SyncStatus.IDLE);
      expect(adapter.isConnected()).toBe(true);
    });

    it('throws when neither url nor client is provided', async () => {
      const adapter = new SQLiteAdapter();
      await expect(adapter.connect({} as any)).rejects.toThrow(/requires either a `url` for HTTP mode or a `client`/i);
    });
  });

  describe('pull — table name validation (buildUrl)', () => {
    it('throws for SQL injection in table name', async () => {
      const adapter = await makeHttpAdapter();
      await expect(
        adapter.pull({ table: 'evil"; DROP TABLE tasks;--' })
      ).rejects.toThrow(/Invalid table name/i);
    });

    it('throws for path traversal in table name', async () => {
      const adapter = await makeHttpAdapter();
      await expect(
        adapter.pull({ table: '../etc/passwd' })
      ).rejects.toThrow(/Invalid table name/i);
    });

    it('throws for semicolon injection in table name', async () => {
      const adapter = await makeHttpAdapter();
      await expect(
        adapter.pull({ table: 'tasks; DROP TABLE tasks;' })
      ).rejects.toThrow(/Invalid table name/i);
    });

    it('accepts valid alphanumeric and underscore table names', async () => {
      const adapter = await makeHttpAdapter();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => []
      } as Response);

      await expect(adapter.pull({ table: 'tasks' })).resolves.toEqual([]);
      await expect(adapter.pull({ table: 'my_table' })).resolves.toEqual([]);
      await expect(adapter.pull({ table: 'Table123' })).resolves.toEqual([]);

      fetchSpy.mockRestore();
    });

    it('trims whitespace before validation (accepts padded valid names)', async () => {
      const adapter = await makeHttpAdapter();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => []
      } as Response);

      await expect(adapter.pull({ table: '  tasks  ' })).resolves.toEqual([]);

      fetchSpy.mockRestore();
    });

    it('throws for whitespace-padded injection payloads after trim', async () => {
      const adapter = await makeHttpAdapter();
      await expect(
        adapter.pull({ table: '  evil"; DROP TABLE tasks;--  ' })
      ).rejects.toThrow(/Invalid table name/i);
    });
  });

  describe('push — table name validation (buildUrl)', () => {
    it('throws for invalid table name via push', async () => {
      const adapter = await makeHttpAdapter();
      const records = [{ id: 1, title: 'x' }] as any;
      await expect(adapter.push(records, { table: '../evil; DROP TABLE tasks;' })).rejects.toThrow(/Invalid table name/i);
    });
  });

  describe('getRemoteSchema — internal endpoint validation (buildUrl)', () => {
    it('throws for table names with path separators (via pull)', async () => {
      const adapter = await makeHttpAdapter();
      await expect(
        adapter.pull({ table: '/etc/passwd' })
      ).rejects.toThrow(/Invalid (table name|endpoint)/i);
    });

    it('resolves for /schema/{table} paths used by getRemoteSchema', async () => {
      const adapter = await makeHttpAdapter();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ name: 'tasks', columns: [] })
      } as Response);

      await expect(adapter.getRemoteSchema('tasks')).resolves.toMatchObject({ name: 'tasks' });

      fetchSpy.mockRestore();
    });
  });
});
