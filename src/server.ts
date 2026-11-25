// Web-Standard Sync Handler
// Exports createSyncHandler for use in Astro API routes, Next.js App Router,
// Hono, Cloudflare Workers, Netlify Functions, and Cloud Run.
// Uses ONLY standard Web Fetch APIs (Request, Response, URL, Headers). Zero node:http imports.

import type { SyncAdapter, ColumnDef } from './sync-adapter.js';

export interface CorsOptions {
  origin?: string | string[];
  methods?: string[];
  headers?: string[];
  credentials?: boolean;
}

export interface SyncHandlerOptions {
  /** The storage adapter (e.g. TursoAdapter, SQLiteAdapter) running server-side */
  adapter: SyncAdapter;
  /**
   * Optional base path prefix to strip from request URLs (e.g. '/api/sync').
   */
  basePath?: string;
  /**
   * CORS configuration: true for standard open defaults, false to disable, or custom options.
   * Default: true
   */
  cors?: boolean | CorsOptions;
  /**
   * Automatically provision remote table schema on push if not already provisioned.
   * Default: true
   */
  autoProvision?: boolean;
  /**
   * Server-side authentication hook resolving the authenticated user id.
   * Compatible with Clerk, Auth.js, JWTs, etc.
   * Return userId string, { userId: string }, or null/undefined if unauthenticated.
   */
  getSessionUser?: (req: Request) => Promise<string | { userId: string } | null | undefined> | string | { userId: string } | null | undefined;
  /**
   * Alias for getSessionUser
   */
  auth?: (req: Request) => Promise<string | { userId: string } | null | undefined> | string | { userId: string } | null | undefined;
  /**
   * Dev-only flag allowing requests without an authenticated session.
   * Default: false. When false and no session is found, requests return 401 Unauthorized.
   */
  allowUnauthenticatedDevMode?: boolean;
  /**
   * Default owner_id used only when allowUnauthenticatedDevMode is true and no session exists.
   * Default: 'demo'
   */
  defaultOwnerId?: string;
}

export interface SyncHandlerResult {
  handler: (req: Request) => Promise<Response>;
  GET: (req: Request) => Promise<Response>;
  POST: (req: Request) => Promise<Response>;
  DELETE: (req: Request) => Promise<Response>;
  OPTIONS: (req: Request) => Promise<Response>;
}

const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function isValidIdentifier(name: unknown): boolean {
  if (typeof name !== 'string' || name.length === 0 || name.length > 128) return false;
  if (name === '__proto__' || name === 'constructor' || name === 'prototype') return false;
  return IDENTIFIER_RE.test(name);
}

export function sanitizeRecord(record: unknown): Record<string, unknown> {
  if (!record || typeof record !== 'object') return {};
  const clean: Record<string, unknown> = Object.create(null);
  for (const [key, val] of Object.entries(record)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (isValidIdentifier(key) || key === '_version' || key === '_deletedAt') {
      clean[key] = val;
    }
  }
  return clean;
}

function getCorsHeaders(req: Request, cors?: boolean | CorsOptions): Record<string, string> {
  if (cors === false) return {};
  const origin = req.headers.get('Origin') || '*';
  const corsOpts = typeof cors === 'object' ? cors : {};

  let allowOrigin = '*';
  if (corsOpts.origin) {
    if (Array.isArray(corsOpts.origin)) {
      allowOrigin = corsOpts.origin.includes(origin) ? origin : corsOpts.origin[0] || '*';
    } else {
      allowOrigin = corsOpts.origin;
    }
  } else if (corsOpts.credentials) {
    allowOrigin = origin;
  }

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': (corsOpts.methods || ['GET', 'POST', 'DELETE', 'OPTIONS']).join(', '),
    'Access-Control-Allow-Headers': (corsOpts.headers || ['Content-Type', 'Authorization', 'X-API-Key', 'Accept']).join(', '),
    'Access-Control-Expose-Headers': 'X-Server-Time, X-Cursor, X-Has-More'
  };

  if (corsOpts.credentials) {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

function jsonResponse(
  data: unknown,
  status = 200,
  corsHeaders?: Record<string, string>,
  extraHeaders?: Record<string, string>
): Response {
  const headers = new Headers({
    'Content-Type': 'application/json',
    ...(corsHeaders || {}),
    ...(extraHeaders || {})
  });
  return new Response(JSON.stringify(data), { status, headers });
}

export function createSyncHandler(options: SyncHandlerOptions): SyncHandlerResult {
  const adapter = options.adapter;
  if (!adapter) {
    throw new Error('createSyncHandler requires an adapter instance');
  }

  const handler = async (req: Request): Promise<Response> => {
    const corsHeaders = getCorsHeaders(req, options.cors);

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: new Headers(corsHeaders) });
    }

    try {
      const url = new URL(req.url);
      let pathname = url.pathname;

      if (options.basePath) {
        const base = options.basePath.replace(/\/+$/, '');
        if (pathname === base) {
          pathname = '/';
        } else if (pathname.startsWith(base + '/')) {
          pathname = pathname.slice(base.length);
        }
      }

      // GET /health
      if (req.method === 'GET' && pathname === '/health') {
        return jsonResponse({ ok: true, serverTime: new Date().toISOString() }, 200, corsHeaders);
      }

      // Authenticate session
      let userId: string | null = null;
      const authFn = options.getSessionUser || options.auth;
      if (authFn) {
        const user = await authFn(req);
        if (typeof user === 'string' && user.length > 0) {
          userId = user;
        } else if (user && typeof user === 'object' && typeof user.userId === 'string' && user.userId.length > 0) {
          userId = user.userId;
        }
      }

      if (!userId) {
        if (options.allowUnauthenticatedDevMode) {
          userId = options.defaultOwnerId || 'demo';
        } else {
          return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
        }
      }

      // GET /schema/:table
      if (req.method === 'GET' && pathname.startsWith('/schema/')) {
        const table = pathname.slice('/schema/'.length);
        if (!isValidIdentifier(table)) {
          return jsonResponse({ error: 'Invalid table name' }, 400, corsHeaders);
        }
        const schema = await adapter.getRemoteSchema(table);
        return jsonResponse(schema, 200, corsHeaders);
      }

      // GET /schema
      if (req.method === 'GET' && pathname === '/schema') {
        return jsonResponse({ ok: true, serverTime: new Date().toISOString() }, 200, corsHeaders);
      }

      // POST /schema or POST /schema/:table
      if (req.method === 'POST' && (pathname === '/schema' || pathname.startsWith('/schema/'))) {
        let body: any = {};
        try {
          body = await req.json();
        } catch {
          return jsonResponse({ error: 'Invalid JSON body' }, 400, corsHeaders);
        }

        const table = pathname.startsWith('/schema/')
          ? pathname.slice('/schema/'.length)
          : body.name || body.table;

        if (!isValidIdentifier(table)) {
          return jsonResponse({ error: 'Invalid or missing table name' }, 400, corsHeaders);
        }

        const columns = Array.isArray(body.columns) ? body.columns : [];
        for (const col of columns) {
          if (!col || !isValidIdentifier(col.name)) {
            return jsonResponse({ error: `Invalid column identifier: ${col?.name}` }, 400, corsHeaders);
          }
        }

        await adapter.ensureTable(table, columns);
        return jsonResponse({ table, ensured: true }, 200, corsHeaders);
      }

      const pathParts = pathname.slice(1).split('/');

      // DELETE /:table/:id
      if (req.method === 'DELETE' && pathParts.length === 2) {
        const [table, id] = pathParts;
        if (!isValidIdentifier(table)) {
          return jsonResponse({ error: 'Invalid table name' }, 400, corsHeaders);
        }

        const now = new Date().toISOString();
        const tombstone = {
          id,
          _deletedAt: now,
          updatedAt: now,
          owner_id: userId
        };
        const result = await adapter.push([tombstone as any], { table });
        return jsonResponse({ deleted: result.pushed > 0, id, table }, 200, corsHeaders);
      }

      // GET /:table or POST /:table
      if (pathParts.length === 1 && pathParts[0] !== '') {
        const table = decodeURIComponent(pathParts[0]);
        if (!isValidIdentifier(table)) {
          return jsonResponse({ error: 'Invalid table name' }, 400, corsHeaders);
        }

        if (req.method === 'GET') {
          const sinceParam = url.searchParams.get('since');
          const since = sinceParam ? new Date(sinceParam) : undefined;
          const cursor = url.searchParams.get('cursor') || undefined;
          const limitParam = url.searchParams.get('limit');
          const limit = limitParam ? Number(limitParam) : 1000;
          const offsetParam = url.searchParams.get('offset');
          const offset = offsetParam ? Number(offsetParam) : undefined;
          const includeDeleted =
            url.searchParams.get('includeDeleted') === 'true' ||
            url.searchParams.get('include_deleted') === 'true';

          // ALWAYS enforce owner_id from authenticated session
          const rows = await adapter.pull({
            table,
            since,
            cursor,
            limit,
            offset,
            includeDeleted,
            where: { owner_id: userId }
          });

          const serverTime = (rows as any).serverTime || new Date().toISOString();
          const nextCursor = (rows as any).cursor || undefined;
          const hasMore = (rows as any).hasMore ?? (rows.length >= limit);

          const extraHeaders: Record<string, string> = {
            'X-Server-Time': serverTime,
            'X-Has-More': String(hasMore)
          };
          if (nextCursor) {
            extraHeaders['X-Cursor'] = nextCursor;
          }

          return jsonResponse(
            {
              records: rows,
              cursor: nextCursor,
              serverTime,
              hasMore
            },
            200,
            corsHeaders,
            extraHeaders
          );
        }

        if (req.method === 'POST') {
          let body: any = {};
          try {
            body = await req.json();
          } catch {
            return jsonResponse({ error: 'Invalid JSON payload' }, 400, corsHeaders);
          }

          const rawRecords = Array.isArray(body) ? body : [body];
          const cleanedRecords: any[] = [];

          for (const raw of rawRecords) {
            const clean = sanitizeRecord(raw);
            // ALWAYS enforce owner_id from authenticated session (overwrite any client-supplied owner_id)
            clean.owner_id = userId;
            cleanedRecords.push(clean);
          }

          // Auto-provision table schema on push if enabled
          if (options.autoProvision !== false && cleanedRecords.length > 0) {
            const userCols: ColumnDef[] = [];
            const seenCols = new Set<string>();
            for (const rec of cleanedRecords) {
              for (const [k, v] of Object.entries(rec)) {
                if (
                  seenCols.has(k) ||
                  k === 'id' ||
                  k === 'updatedAt' ||
                  k === '_version' ||
                  k === '_deletedAt' ||
                  k === 'owner_id'
                ) {
                  continue;
                }
                if (!isValidIdentifier(k)) continue;
                seenCols.add(k);
                let colType = 'string';
                if (typeof v === 'number') colType = 'integer';
                else if (typeof v === 'boolean') colType = 'boolean';
                else if (Array.isArray(v) || (typeof v === 'object' && v !== null)) colType = 'json';
                userCols.push({ name: k, type: colType, nullable: true });
              }
            }

            await adapter.ensureTable(table, [
              { name: 'id', type: 'string', nullable: false, primaryKey: true },
              { name: 'updatedAt', type: 'datetime', nullable: false, default: '' },
              { name: 'version', type: 'integer', nullable: false, default: 1 },
              { name: 'deleted_at', type: 'datetime', nullable: true },
              { name: 'owner_id', type: 'string', nullable: true, default: 'demo' },
              ...userCols
            ]);
          }

          const pushResult = await adapter.push(cleanedRecords, { table });
          return jsonResponse(
            {
              pushed: pushResult.pushed,
              conflicts: pushResult.conflicts,
              errors: pushResult.errors.map((e, i) => ({
                id: cleanedRecords[i]?.id,
                error: e.error
              }))
            },
            200,
            corsHeaders
          );
        }
      }

      return jsonResponse({ error: 'Not Found', path: pathname, method: req.method }, 404, corsHeaders);
    } catch (err) {
      // Do not leak internal stack traces to clients
      const message = err instanceof Error ? err.message : 'Internal Server Error';
      return jsonResponse({ error: message.replace(/[\n\r].*/s, '') }, 500, corsHeaders);
    }
  };

  return {
    handler,
    GET: (req: Request) => handler(req),
    POST: (req: Request) => handler(req),
    DELETE: (req: Request) => handler(req),
    OPTIONS: (req: Request) => handler(req)
  };
}
