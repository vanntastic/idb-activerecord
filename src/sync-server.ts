// Sync Server
// Provides a ready-to-use HTTP server for sync adapters with REST endpoints
// for schema operations, pull/push, and soft deletes. Adapter-agnostic.

import http from 'node:http';
import type { BaseAdapter } from './sync-adapter.js';

export interface SyncServerConfig {
  /** Port to listen on (default: 3002) */
  port?: number;
  /** Adapter to use for storage operations */
  adapter: BaseAdapter;
  /** Custom route handlers (override defaults) */
  routes?: SyncServerRoutes;
}

export interface SyncServerRoutes {
  /** Override GET /health */
  health?: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> | void;
  /** Override GET /schema/:table */
  getSchema?: (req: http.IncomingMessage, res: http.ServerResponse, table: string) => Promise<void> | void;
  /** Override POST /schema */
  postSchema?: (req: http.IncomingMessage, res: http.ServerResponse, body: any) => Promise<void> | void;
  /** Override POST /migrations */
  postMigrations?: (req: http.IncomingMessage, res: http.ServerResponse, body: any) => Promise<void> | void;
  /** Override GET /:table */
  getTable?: (req: http.IncomingMessage, res: http.ServerResponse, table: string, url: URL) => Promise<void> | void;
  /** Override POST /:table */
  postTable?: (req: http.IncomingMessage, res: http.ServerResponse, table: string, records: any[]) => Promise<void> | void;
  /** Override DELETE /:table/:id */
  deleteItem?: (req: http.IncomingMessage, res: http.ServerResponse, table: string, id: number) => Promise<void> | void;
}

const TABLE_RE = /^[a-z_][a-z0-9_]*$/i;

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key'
  });
  res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

export class SyncServer {
  private server?: http.Server;
  private port: number;
  private adapter: BaseAdapter;
  private routes: SyncServerRoutes;

  constructor(config: SyncServerConfig) {
    this.port = config.port ?? 3002;
    this.adapter = config.adapter;
    this.routes = config.routes ?? {};
  }

  async init(): Promise<void> {
    this.server = http.createServer(async (req, res) => {
      try {
        await this.handleRequest(req, res);
      } catch (err) {
        console.error('Request error:', err);
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    });

    return new Promise<void>((resolve) => {
      this.server!.listen(this.port, () => {
        console.log(`\n🚀 Schema Server running at http://localhost:${this.port}`);
        console.log(`\nEndpoints:`);
        console.log(`  GET    /health`);
        console.log(`  GET    /schema/:table`);
        console.log(`  POST   /schema`);
        console.log(`  GET    /:table`);
        console.log(`  POST   /:table`);
        console.log(`  DELETE /:table/:id`);
        console.log(`  POST   /migrations`);
        console.log(`\nPress Ctrl+C to stop\n`);
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
    }
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url!, `http://localhost:${this.port}`);
    const pathname = url.pathname;
    const method = req.method!;

    console.log(`${method} ${pathname}`);

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key'
      });
      res.end();
      return;
    }

    // GET /health
    if (pathname === '/health' && method === 'GET') {
      if (this.routes.health) {
        return this.routes.health(req, res);
      }
      return sendJson(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
    }

    // GET /schema/:table
    if (pathname.startsWith('/schema/') && method === 'GET') {
      const table = pathname.slice('/schema/'.length);
      if (!TABLE_RE.test(table)) return sendJson(res, 400, { error: 'Invalid table name' });
      if (this.routes.getSchema) {
        return this.routes.getSchema(req, res, table);
      }
      try {
        const schema = await this.adapter.getRemoteSchema(table);
        return sendJson(res, 200, schema);
      } catch (err) {
        return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    }

    // POST /schema
    if (pathname === '/schema' && method === 'POST') {
      const body = await readBody(req);
      const table = body.name ?? body.table;
      if (!TABLE_RE.test(table || '')) {
        return sendJson(res, 400, { error: 'Invalid or missing table name' });
      }
      const columns = Array.isArray(body.columns) ? body.columns : [];
      if (columns.length === 0) return sendJson(res, 400, { error: 'columns array is required' });
      if (this.routes.postSchema) {
        return this.routes.postSchema(req, res, body);
      }
      try {
        await this.adapter.ensureTable(table, columns);
        return sendJson(res, 200, { table, ensured: true });
      } catch (err) {
        return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    }

    // POST /migrations
    if (pathname === '/migrations' && method === 'POST') {
      const body = await readBody(req);
      if (this.routes.postMigrations) {
        return this.routes.postMigrations(req, res, body);
      }
      return sendJson(res, 200, { applied: true, version: body.version, note: 'no-op by default' });
    }

    // GET /:table
    const tableMatch = pathname.match(/^\/([a-z_][a-z0-9_]*)$/i)?.[1];
    if (tableMatch && method === 'GET') {
      if (this.routes.getTable) {
        return this.routes.getTable(req, res, tableMatch, url);
      }
      const since = url.searchParams.get('since');
      const ownerId = url.searchParams.get('owner_id') || 'demo';
      const includeDeleted = url.searchParams.get('include_deleted') === 'true';
      try {
        const rows = await this.adapter.pull({
          table: tableMatch,
          since: since ? new Date(since) : undefined,
          where: { owner_id: ownerId },
          includeDeleted
        });
        return sendJson(res, 200, rows);
      } catch (err) {
        return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    }

    // POST /:table
    if (tableMatch && method === 'POST') {
      const body = await readBody(req);
      const records = Array.isArray(body) ? body : [body];
      if (this.routes.postTable) {
        return this.routes.postTable(req, res, tableMatch, records);
      }
      try {
        const result = await this.adapter.push(records, { table: tableMatch });
        return sendJson(res, 200, {
          pushed: result.pushed,
          rejected: result.errors.map((e, i) => ({
            id: records[i]?.id,
            reason: e.error
          }))
        });
      } catch (err) {
        return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    }

    // DELETE /:table/:id
    const itemMatch = pathname.match(/^\/([a-z_][a-z0-9_]*)\/(\d+)$/i);
    if (itemMatch && method === 'DELETE') {
      const [, table, idStr] = itemMatch;
      if (this.routes.deleteItem) {
        return this.routes.deleteItem(req, res, table, Number(idStr));
      }
      // Default implementation: soft delete via push
      try {
        const result = await this.adapter.push([{ id: Number(idStr), _deletedAt: new Date().toISOString() } as any], { table });
        return sendJson(res, 200, { deleted: result.pushed });
      } catch (err) {
        return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    }

    sendJson(res, 404, { error: 'Not Found', path: pathname, method });
  }
}
