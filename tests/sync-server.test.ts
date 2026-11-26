import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { SyncServer } from '../src/sync-server';
import { BaseAdapter, SyncResult, SyncStatus } from '../src/sync-adapter';

class MockAdapter extends BaseAdapter {
  records: any[] = [];
  lastPullWhere: any = null;
  lastPushed: any[] = [];

  async connect(): Promise<void> {
    this.connected = true;
    this.updateState({ status: SyncStatus.IDLE });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async pull<T>(query: any): Promise<T[]> {
    this.lastPullWhere = query.where;
    return this.records.filter(r => !query.where?.owner_id || r.owner_id === query.where.owner_id) as T[];
  }

  async push<T>(records: T[], options?: any): Promise<SyncResult> {
    this.lastPushed = records as any[];
    for (const r of records as any[]) {
      this.records.push(r);
    }
    return { pushed: records.length, pulled: 0, conflicts: 0, errors: [], timestamp: new Date() };
  }

  async getRemoteSchema(table: string) {
    return { name: table, columns: [], indexes: [] };
  }
  async ensureTable() {}
  async applyMigration() {}
}

function makeRequest(
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: any } = {}
): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `http://localhost:${port}${path}`,
      {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      },
      (res) => {
        let raw = '';
        res.on('data', chunk => (raw += chunk));
        res.on('end', () => {
          let parsed = {};
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode || 200, body: parsed, headers: res.headers });
        });
      }
    );
    req.on('error', reject);
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

describe('SyncServer with getSessionUser auth support', () => {
  it('enforces authentication when getSessionUser is configured', async () => {
    const adapter = new MockAdapter();
    await adapter.connect();

    const server = new SyncServer({
      port: 3912,
      adapter,
      getSessionUser: (req) => {
        const token = req.headers.authorization;
        return token === 'Bearer user_secret' ? 'user_alice' : null;
      }
    });

    await server.init();

    try {
      // 1. Unauthenticated request -> 401
      const unauth = await makeRequest(3912, '/tasks');
      expect(unauth.status).toBe(401);
      expect(unauth.body.error).toBe('Unauthorized');

      // 2. Authenticated request -> 200 and owner_id enforced
      const auth = await makeRequest(3912, '/tasks', {
        headers: { authorization: 'Bearer user_secret' }
      });
      expect(auth.status).toBe(200);
      expect(adapter.lastPullWhere?.owner_id).toBe('user_alice');

      // 3. Push enforces owner_id
      const pushed = await makeRequest(3912, '/tasks', {
        method: 'POST',
        headers: { authorization: 'Bearer user_secret' },
        body: [{ id: 't1', title: 'Task 1', owner_id: 'spoofed_bob' }]
      });
      expect(pushed.status).toBe(200);
      expect(adapter.lastPushed[0].owner_id).toBe('user_alice');
    } finally {
      await server.close();
    }
  });

  it('preserves backward compatibility when getSessionUser is omitted', async () => {
    const adapter = new MockAdapter();
    await adapter.connect();

    const server = new SyncServer({
      port: 3913,
      adapter
    });

    await server.init();

    try {
      const res = await makeRequest(3913, '/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');

      const pull = await makeRequest(3913, '/tasks?owner_id=legacy_user');
      expect(pull.status).toBe(200);
      expect(adapter.lastPullWhere?.owner_id).toBe('legacy_user');
    } finally {
      await server.close();
    }
  });
});
