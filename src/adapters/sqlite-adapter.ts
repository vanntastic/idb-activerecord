// SQLite Adapter for Node.js built-in node:sqlite
// Works with DatabaseSync from node:sqlite for server-side sync,
// or in HTTP mode for browser-side sync to a SyncServer.

import { BaseAdapter } from '../sync-adapter.js';
import type {
  AdapterConfig,
  SyncQuery,
  PushOptions,
  SyncResult,
  TableSchema,
  ColumnDef
} from '../sync-adapter.js';
import { SyncStatus } from '../sync-adapter.js';

export interface SQLiteClient {
  prepare(sql: string): {
    run(...args: unknown[]): { changes: number; lastInsertRowid: number };
    all(...args: unknown[]): unknown[];
    get(...args: unknown[]): unknown | undefined;
  };
  close(): void;
}

export interface SQLiteAdapterConfig extends AdapterConfig {
  /**
   * A connected node:sqlite DatabaseSync instance.
   * If not provided, the adapter runs in HTTP mode and expects `url` to be set.
   */
  client?: SQLiteClient;
  /**
   * Base URL for HTTP mode (e.g., 'http://localhost:3001').
   * If provided, the adapter makes HTTP requests instead of using a direct client.
   */
  url?: string;
  /**
   * Endpoint pattern for HTTP mode (e.g., '/{table}').
   * Replaces '{table}' with the actual table name.
   */
  endpointPattern?: string;
  /** Default owner_id when a record doesn't carry one (defaults to 'demo'). */
  defaultOwnerId?: string;
}

// SQL columns reserved for sync meta — excluded from user-column discovery.
const META_COLS = new Set(['id', 'updatedAt', 'version', 'deleted_at', 'owner_id']);

/**
 * SQLite (node:sqlite) sync adapter.
 *
 * Supports two modes:
 * - Direct client mode (server-side): Pass a DatabaseSync instance
 * - HTTP mode (browser-side): Pass url/endpointPattern to talk to SyncServer
 *
 * ```ts
 * import { DatabaseSync } from 'node:sqlite';
 * import { SQLiteAdapter } from 'idb-activerecord';
 *
 * // Direct client mode (server)
 * const db = new DatabaseSync('app.db');
 * const adapter = new SQLiteAdapter();
 * await adapter.connect({ client: db });
 *
 * // HTTP mode (browser)
 * const adapter = new SQLiteAdapter();
 * await adapter.connect({
 *   url: 'http://localhost:3001',
 *   endpointPattern: '/{table}'
 * });
 * ```
 */
export class SQLiteAdapter extends BaseAdapter {
  private client?: SQLiteClient;
  private httpUrl?: string;
  private httpEndpointPattern?: string;
  private useHttp = false;
  config!: SQLiteAdapterConfig;

  async connect(config: SQLiteAdapterConfig): Promise<void> {
    if (!config) {
      throw new Error('SQLiteAdapter.connect() requires a config object.');
    }
    this.config = config;

    // HTTP mode: use url/endpointPattern to make HTTP requests
    if (config.url) {
      this.httpUrl = config.url;
      this.httpEndpointPattern = config.endpointPattern ?? '/{table}';
      this.useHttp = true;
      this.connected = true;
      this.updateState({ status: SyncStatus.IDLE });
      return;
    }

    // Direct client mode: use a database client
    if (!config.client) {
      throw new Error(
        'SQLiteAdapter.connect() requires either a `url` for HTTP mode or a `client` for direct mode. ' +
        'Create one with `new DatabaseSync(path)` from node:sqlite first.'
      );
    }
    this.client = config.client;
    this.connected = true;
    this.updateState({ status: SyncStatus.IDLE });
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.close();
    }
    this.connected = false;
  }

  async applyMigration(migration: { version: number; name: string; sql?: string }): Promise<void> {
    if (this.useHttp) {
      // HTTP mode: no-op (SyncServer handles migrations)
      return;
    }
    // SQLite doesn't have built-in migration tracking in this adapter
    // The migrations table is managed by the server or SyncServer
    if (migration.sql) {
      await this.exec(migration.sql);
    }
  }

  private async exec(sql: string, params: unknown[] = []): Promise<void> {
    if (!this.client) throw new Error('Client not connected');
    const stmt = this.client.prepare(sql);
    stmt.run(...params);
  }

  private async queryAll<R>(sql: string, params: unknown[] = []): Promise<R[]> {
    if (!this.client) throw new Error('Client not connected');
    const stmt = this.client.prepare(sql);
    return stmt.all(...params) as R[];
  }

  private buildUrl(table: string, queryParams: Record<string, string> = {}): string {
    let endpoint: string;
    if (table.startsWith('/')) {
      const allowedInternalEndpoints = new Set(['/schema', '/migrations']);
      if (!allowedInternalEndpoints.has(table) && !table.startsWith('/schema/')) {
        throw new Error(`Invalid endpoint: ${table}`);
      }
      endpoint = table;
    } else {
      if (!/^[a-z_][a-z0-9_]*$/i.test(table)) {
        throw new Error(`Invalid table name: ${table}`);
      }
      endpoint = this.httpEndpointPattern!.replace('{table}', encodeURIComponent(table));
    }
    const url = new URL(endpoint, this.httpUrl!);
    for (const [key, value] of Object.entries(queryParams)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private async httpGet<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.authToken ? { 'Authorization': this.config.authToken } : {}),
        ...(this.config.apiKey ? { 'X-API-Key': this.config.apiKey } : {}),
        ...this.config.headers
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json() as T;
  }

  private async httpPost<T>(url: string, body: unknown): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.authToken ? { 'Authorization': this.config.authToken } : {}),
        ...(this.config.apiKey ? { 'X-API-Key': this.config.apiKey } : {}),
        ...this.config.headers
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json() as T;
  }

  
  /**
   * Create the table if missing, or ALTER TABLE ADD COLUMN for any newly
   * declared columns. SQLite's ALTER TABLE is limited (no drop/rename),
   * so existing columns are never modified.
   */
  async ensureTable(table: string, columns: ColumnDef[] = []): Promise<void> {
    this.requireConnected();
    if (columns.length === 0) return;

    if (this.useHttp) {
      await this.httpPost(this.buildUrl('/schema'), { table, columns });
      return;
    }

    const existing = await this.queryAll<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
      [table]
    );

    if (existing.length === 0) {
      const colDefs = columns.map(c => this.columnSql(c)).join(',\n  ');
      await this.exec(`CREATE TABLE ${this.identifier(table)} (\n  ${colDefs}\n)`);
      return;
    }

    const info = await this.queryAll<{ name: string }>(
      `PRAGMA table_info(${this.identifier(table)})`
    );
    const have = new Set(info.map(r => r.name));
    for (const col of columns) {
      if (!have.has(col.name)) {
        await this.exec(
          `ALTER TABLE ${this.identifier(table)} ADD COLUMN ${this.columnSql(col)}`
        );
      }
    }
  }

  async pull<T>(query: SyncQuery): Promise<T[]> {
    this.requireConnected();
    this.updateState({ status: SyncStatus.SYNCING });

    try {
      if (this.useHttp) {
        const queryParams: Record<string, string> = {};
        if (query.since) queryParams.since = query.since.toISOString();
        if (query.where) {
          for (const [k, v] of Object.entries(query.where)) {
            queryParams[k] = String(v);
          }
        }
        if (query.includeDeleted) queryParams.include_deleted = 'true';
        if (query.limit) queryParams.limit = String(query.limit);
        if (query.offset) queryParams.offset = String(query.offset);

        const rows = await this.httpGet<Record<string, unknown>[]>(
          this.buildUrl(query.table, queryParams)
        );
        this.updateState({ lastPullAt: new Date(), status: SyncStatus.IDLE });
        return rows as T[];
      }

      const conditions: string[] = [];
      const params: unknown[] = [];

      if (query.since) {
        conditions.push('updatedAt > ?');
        params.push(query.since.toISOString());
      }
      if (query.where) {
        for (const [k, v] of Object.entries(query.where)) {
          conditions.push(`${this.identifier(k)} = ?`);
          params.push(v);
        }
      }
      if (!query.includeDeleted) {
        conditions.push('deleted_at IS NULL');
      }

      let sql = `SELECT * FROM ${this.identifier(query.table)}`;
      if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`;
      sql += ` ORDER BY id ASC`;
      if (query.limit) sql += ` LIMIT ${Number(query.limit)}`;
      if (query.offset) sql += ` OFFSET ${Number(query.offset)}`;

      const rows = await this.queryAll<Record<string, unknown>>(sql, params);

      // Map SQL columns -> SyncEngine wire format (_version, _deletedAt).
      const mapped = rows.map(row => ({
        ...row,
        _version: row.version,
        _deletedAt: (row.deleted_at ?? null) as string | null
      })) as unknown as T[];

      this.updateState({ lastPullAt: new Date(), status: SyncStatus.IDLE });
      return mapped;
    } catch (err) {
      this.updateState({ status: SyncStatus.ERROR });
      throw err;
    }
  }

  async push<T>(records: T[], options: PushOptions = {}): Promise<SyncResult> {
    this.requireConnected();
    const result: SyncResult = {
      pushed: 0,
      pulled: 0,
      conflicts: 0,
      errors: [],
      timestamp: new Date()
    };
    if (records.length === 0) return result;

    this.updateState({ status: SyncStatus.SYNCING });

    try {
      const first = records[0]!;
      const RecordClass = first.constructor as { tableName?: string };
      const table = options.table || RecordClass.tableName;
      if (!table) throw new Error('Cannot push records without tableName');

      if (this.useHttp) {
        const response = await this.httpPost<{ pushed: number; rejected: { id: unknown; reason: string }[] }>(
          this.buildUrl(table),
          records
        );
        result.pushed = response.pushed;
        result.errors = response.rejected.map(r => ({
          record: records.find(rec => (rec as unknown as Record<string, unknown>).id === r.id),
          error: r.reason
        }));
        this.updateState({
          lastPushAt: new Date(),
          pendingOperations: 0,
          status: SyncStatus.IDLE
        });
        return result;
      }

      const now = new Date().toISOString();
      const defaultOwnerId =
        (this.config as SQLiteAdapterConfig).defaultOwnerId ?? 'demo';

      // Discover user columns from PRAGMA so we only write columns that exist.
      const info = await this.queryAll<{ name: string }>(
        `PRAGMA table_info(${this.identifier(table)})`
      );
      const userCols = info.map(r => r.name).filter(c => !META_COLS.has(c));

      for (const record of records) {
        try {
          const data = record as unknown as Record<string, unknown>;
          const incomingVersion = (data._version as number) || 1;
          const deletedAt = (data._deletedAt as string | null) ?? null;
          const ownerId = (data.owner_id as string) || defaultOwnerId;
          const updatedAt = (data.updatedAt as string) || now;

          // Optimistic concurrency: reject if server version is newer.
          if (data.id !== undefined && data.id !== null) {
            const existing = await this.queryAll<{ version: number }>(
              `SELECT version FROM ${this.identifier(table)} WHERE id = ?`,
              [data.id]
            );
            if (
              existing.length > 0 &&
              (existing[0]!.version as number) > incomingVersion
            ) {
              result.conflicts += 1;
              result.errors.push({
                record,
                error: `version_conflict: server=${existing[0]!.version} client=${incomingVersion}`
              });
              continue;
            }
          }

          const userVals = userCols.map(c => this.toSqlValue(data[c]));
          const allCols = [
            ...userCols,
            'updatedAt',
            'version',
            'deleted_at',
            'owner_id'
          ];
          const allVals = [
            ...userVals,
            updatedAt,
            incomingVersion,
            deletedAt,
            ownerId
          ];

          if (data.id !== undefined && data.id !== null) {
            const cols = ['id', ...allCols];
            const vals = [data.id, ...allVals];
            const placeholders = cols.map(() => '?').join(', ');
            const setClauses = allCols
              .map(c => `${this.identifier(c)} = excluded.${this.identifier(c)}`)
              .join(', ');
            await this.exec(
              `INSERT INTO ${this.identifier(table)} (${cols
                .map(c => this.identifier(c))
                .join(', ')}) VALUES (${placeholders}) ` +
              `ON CONFLICT(id) DO UPDATE SET ${setClauses}`,
              vals
            );
          } else {
            const placeholders = allCols.map(() => '?').join(', ');
            await this.exec(
              `INSERT INTO ${this.identifier(table)} (${allCols
                .map(c => this.identifier(c))
                .join(', ')}) VALUES (${placeholders})`,
              allVals
            );
          }

          result.pushed += 1;
        } catch (err) {
          result.errors.push({
            record,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }

      this.updateState({
        lastPushAt: new Date(),
        pendingOperations: 0,
        status: SyncStatus.IDLE
      });
      return result;
    } catch (err) {
      this.updateState({ status: SyncStatus.ERROR });
      throw err;
    }
  }

  async getRemoteSchema(table: string): Promise<TableSchema> {
    this.requireConnected();

    if (this.useHttp) {
      return await this.httpGet<TableSchema>(this.buildUrl(`/schema/${table}`));
    }

    const rows = await this.queryAll<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
      dflt_value: unknown;
    }>(`PRAGMA table_info(${this.identifier(table)})`);

    const columns: ColumnDef[] = rows.map(r => ({
      name: r.name,
      type: this.fromSqliteType(r.type),
      nullable: r.notnull === 0,
      ...(r.pk === 1 ? { primaryKey: true } : {}),
      ...(r.dflt_value !== null && r.dflt_value !== undefined
        ? { default: r.dflt_value }
        : {})
    }));

    return { name: table, columns, indexes: [] };
  }

  // SQL helpers
  private requireConnected(): void {
    if (!this.isConnected()) {
      throw new Error('Adapter not connected. Call connect() first.');
    }
  }

  private identifier(name: string): string {
    if (typeof name !== 'string') {
      throw new Error('Table/column name must be a string');
    }
    if (name.includes('"')) {
      throw new Error('Table/column name cannot contain double quotes');
    }
    return `"${name}"`;
  }

  private columnSql(col: ColumnDef): string {
    const parts = [this.identifier(col.name), this.toSqlType(col.type)];
    if (col.primaryKey) parts.push('PRIMARY KEY');
    if (col.autoIncrement) parts.push('AUTOINCREMENT');
    if (col.nullable === false && !col.primaryKey) parts.push('NOT NULL');
    if (col.default !== undefined && col.default !== null) {
      if (typeof col.default === 'string') {
        parts.push(`DEFAULT '${col.default.replace(/'/g, "''")}'`);
      } else if (typeof col.default === 'number' || typeof col.default === 'boolean') {
        parts.push(`DEFAULT ${Number(col.default)}`);
      } else {
        parts.push(`DEFAULT ${col.default}`);
      }
    }
    return parts.join(' ');
  }

  private toSqlType(type?: string): string {
    if (type === 'integer' || type === 'boolean') return 'INTEGER';
    return 'TEXT';
  }

  private fromSqliteType(type?: string): 'string' | 'integer' | 'boolean' {
    if (type === 'INTEGER') return 'integer';
    return 'string';
  }

  private toSqlValue(val: unknown): unknown {
    if (val === null || val === undefined) return null;
    if (typeof val === 'boolean') return val ? 1 : 0;
    return val;
  }
}
