// Turso (libSQL / SQLite) Sync Adapter
// Talks directly to a Turso/libSQL/SQLite database.
//
// Accepts a raw `@libsql/client` instance directly, or a custom client matching
// the `TursoClient` interface for other drivers (e.g. `@tursodatabase/database`).

import {
  BaseAdapter,
  AdapterConfig,
  SyncQuery,
  PushOptions,
  SyncResult,
  TableSchema,
  SyncMigration,
  SyncStatus,
  ColumnDef
} from '../sync-adapter.js';
import { ActiveRecord } from '../activerecord.js';

/**
 * Minimal subset of the `@tursodatabase/database` client API this adapter uses.
 * Compatible with any driver exposing prepared statements with `.run()` and
 * `.all()` methods (sync or async). Used for custom clients.
 */
export interface TursoClient {
  prepare(sql: string): TursoStatement;
  close?(): void | Promise<void>;
}

export interface TursoStatement {
  run(...args: unknown[]): unknown | Promise<unknown>;
  all(...args: unknown[]): unknown[] | Promise<unknown[]>;
}

/**
 * Raw `@libsql/client` interface for type detection.
 * Only the methods we need are declared.
 */
interface LibsqlClient {
  execute(options: { sql: string; args?: unknown[] }): Promise<{
    rows: unknown[];
    rowsAffected: number;
    lastInsertRowid?: number;
    columns: string[];
  }>;
  close(): void;
}

export interface TursoAdapterConfig extends AdapterConfig {
  /**
   * A connected Turso/libSQL/SQLite client.
   * Pass a raw `@libsql/client` instance directly, or a custom client matching
   * the `TursoClient` interface for other drivers.
   *
   * If not provided, the adapter runs in HTTP mode and expects `url` to be set.
   */
  client?: LibsqlClient | TursoClient;
  /**
   * Base URL for HTTP mode (e.g., 'http://localhost:3002').
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
 * Turso (libSQL / SQLite) sync adapter.
 *
 * Provisions tables via `CREATE TABLE IF NOT EXISTS`, propagates schema
 * changes via `ALTER TABLE ADD COLUMN`, and handles push/pull with
 * version-based conflict detection. Maps the wire fields `_version` /
 * `_deletedAt` to the SQL columns `version` / `deleted_at`.
 *
 * @example
 * ```ts
 * import { createClient } from '@libsql/client';
 * import { TursoAdapter } from 'idb-activerecord';
 *
 * const client = createClient({ url: 'libsql://my-db.turso.io', authToken });
 * const adapter = new TursoAdapter();
 * await adapter.connect({ client });
 *
 * db.enableAutoSync(adapter, { debounceMs: 500 });
 * ```
 */
export class TursoAdapter extends BaseAdapter {
  private client?: TursoClient;
  private rawClient?: LibsqlClient;
  private httpUrl?: string;
  private httpEndpointPattern?: string;
  private useHttp = false;

  async connect(config: TursoAdapterConfig): Promise<void> {
    if (!config) {
      throw new Error('TursoAdapter.connect() requires a config object.');
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
        'TursoAdapter.connect() requires either a `url` for HTTP mode or a `client` for direct mode. ' +
        'Create one with `createClient(...)` from @libsql/client or your Turso/libSQL driver first.'
      );
    }

    // Detect if the client is already a TursoClient-compatible instance (has prepare).
    // If not, assume it's a raw @libsql/client and shim it.
    const raw = config.client as LibsqlClient;
    if (typeof (config.client as TursoClient).prepare === 'function') {
      // Already a TursoClient-compatible instance
      this.client = config.client as TursoClient;
    } else {
      // Raw @libsql/client — shim to TursoClient interface
      this.rawClient = raw;
      this.client = this.shimLibsqlClient(raw);
    }

    this.connected = true;
    this.updateState({ status: SyncStatus.IDLE });
  }

  async disconnect(): Promise<void> {
    // Close the raw libsql client if we have one (it has its own close method)
    if (this.rawClient) {
      this.rawClient.close();
    } else if (this.client && this.client.close) {
      await this.client.close();
    }
    this.connected = false;
    this.updateState({ status: SyncStatus.IDLE });
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
      // HTTP mode: POST /schema to create/alter table
      const url = this.httpUrl! + '/schema';
      const body = JSON.stringify({ name: table, columns });
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Failed to ensure table: ${err}`);
      }
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

  async pull<T extends ActiveRecord>(query: SyncQuery): Promise<T[]> {
    this.requireConnected();
    this.updateState({ status: SyncStatus.SYNCING });

    try {
      if (this.useHttp) {
        // HTTP mode: GET /:table with query params
        if (!/^[a-z_][a-z0-9_]*$/i.test(query.table)) {
          throw new Error(`Invalid table name: ${query.table}`);
        }
        const safeTable = encodeURIComponent(query.table);
        const endpoint = this.httpEndpointPattern!.replace('{table}', safeTable);
        const url = new URL(endpoint, this.httpUrl);
        if (query.since) url.searchParams.set('since', query.since.toISOString());
        if (query.where) {
          for (const [k, v] of Object.entries(query.where)) {
            url.searchParams.set(k, String(v));
          }
        }
        if (!query.includeDeleted) url.searchParams.set('includeDeleted', 'false');
        if (query.limit) url.searchParams.set('limit', String(query.limit));
        if (query.offset) url.searchParams.set('offset', String(query.offset));

        const res = await fetch(url.toString());
        if (!res.ok) {
          const err = await res.text();
          throw new Error(`Pull failed: ${err}`);
        }
        const rows = await res.json();

        this.updateState({ lastPullAt: new Date(), status: SyncStatus.IDLE });
        return rows as T[];
      }

      const conditions: string[] = [];
      const params: unknown[] = [];

      if (query.since) {
        conditions.push(`updatedAt > ?`);
        params.push(query.since.toISOString());
      }
      if (query.where) {
        for (const [k, v] of Object.entries(query.where)) {
          conditions.push(`${this.identifier(k)} = ?`);
          params.push(v);
        }
      }
      if (!query.includeDeleted) {
        conditions.push(`deleted_at IS NULL`);
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

  async push<T extends ActiveRecord>(
    records: T[],
    options: PushOptions = {}
  ): Promise<SyncResult> {
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
      const RecordClass = first.constructor as typeof ActiveRecord;
      const table =
        options.table ||
        (RecordClass as unknown as { tableName?: string }).tableName;
      if (!table) throw new Error('Cannot push records without tableName');

      if (this.useHttp) {
        // HTTP mode: POST /:table with records
        const endpoint = this.httpEndpointPattern!.replace('{table}', table);
        const url = this.httpUrl! + endpoint;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(records)
        });
        if (!res.ok) {
          const err = await res.text();
          throw new Error(`Push failed: ${err}`);
        }
        const pushResult = await res.json();
        result.pushed = pushResult.pushed ?? records.length;
        result.conflicts = pushResult.conflicts ?? 0;
        result.errors = pushResult.errors ?? [];

        this.updateState({
          lastPushAt: new Date(),
          pendingOperations: 0,
          status: SyncStatus.IDLE
        });
        return result;
      }

      const now = new Date().toISOString();
      const defaultOwnerId =
        (this.config as TursoAdapterConfig).defaultOwnerId ?? 'demo';

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
      // HTTP mode: GET /schema/:table
      const url = this.httpUrl! + `/schema/${table}`;
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Failed to get schema: ${err}`);
      }
      return await res.json();
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

  async applyMigration(_migration: SyncMigration): Promise<void> {
    // No-op for Turso. Schema is provisioned via `ensureTable`. Override this
    // method in a subclass if you need to track applied migrations server-side.
  }

  // ------------------------------------------------------------------
  // SQL helpers
  // ------------------------------------------------------------------

  private requireConnected(): void {
    if (!this.isConnected()) {
      throw new Error('Adapter not connected. Call connect() first.');
    }
  }

  private async exec(sql: string, params: unknown[] = []): Promise<void> {
    if (this.useHttp) {
      throw new Error('exec() is not supported in HTTP mode. Use the adapter methods directly.');
    }
    const stmt = this.client!.prepare(sql);
    await Promise.resolve(stmt.run(...params));
  }

  private async queryAll<R>(
    sql: string,
    params: unknown[] = []
  ): Promise<R[]> {
    if (this.useHttp) {
      throw new Error('queryAll() is not supported in HTTP mode. Use the adapter methods directly.');
    }
    const stmt = this.client!.prepare(sql);
    const rows = await Promise.resolve(stmt.all(...params));
    return rows as R[];
  }

  /**
   * Quote a SQL identifier (table or column). Uses double-quote SQLite syntax.
   * Throws on names containing double quotes or non-string input to prevent
   * injection through user-supplied table/column names.
   */
  private identifier(name: string): string {
    if (typeof name !== 'string' || name.length === 0 || name.includes('"')) {
      throw new Error(`Invalid SQL identifier: ${String(name)}`);
    }
    return `"${name}"`;
  }

  private columnSql(col: ColumnDef): string {
    const sqlType = this.toSqliteType(col.type);
    const parts = [`${this.identifier(col.name)} ${sqlType}`];
    if (col.primaryKey) parts.push('PRIMARY KEY');
    if (col.autoIncrement) parts.push('AUTOINCREMENT');
    if (col.nullable === false) parts.push('NOT NULL');
    if (col.default !== undefined) {
      parts.push(`DEFAULT ${this.formatDefault(col.default)}`);
    }
    return parts.join(' ');
  }

  private toSqliteType(t: string | undefined): string {
    switch ((t ?? 'string').toLowerCase()) {
      case 'integer':
      case 'boolean':
        return 'INTEGER';
      case 'real':
      case 'float':
      case 'number':
        return 'REAL';
      case 'datetime':
      case 'string':
      case 'text':
      default:
        return 'TEXT';
    }
  }

  private fromSqliteType(t: string): string {
    const u = (t ?? '').toUpperCase();
    if (u === 'INTEGER') return 'integer';
    if (u === 'REAL' || u === 'NUMERIC') return 'real';
    return 'string';
  }

  private formatDefault(v: unknown): string {
    if (v === null) return 'NULL';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? '1' : '0';
    return `'${String(v).replace(/'/g, "''")}'`;
  }

  private toSqlValue(v: unknown): unknown {
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v instanceof Date) return v.toISOString();
    return v;
  }

  /**
   * Shim a raw `@libsql/client` instance to the TursoClient interface.
   * @libsql/client uses `execute({ sql, args })` while TursoClient expects
   * `prepare(sql).run(...args)` / `.all(...args)`.
   */
  private shimLibsqlClient(client: LibsqlClient): TursoClient {
    return {
      prepare(sql: string): TursoStatement {
        return {
          async run(...args: unknown[]) {
            const result = await client.execute({ sql, args });
            return {
              changes: result.rowsAffected,
              lastInsertRowid: result.lastInsertRowid
            };
          },
          async all(...args: unknown[]) {
            const result = await client.execute({ sql, args });
            // libSQL returns rows as plain objects keyed by column name. Drop the
            // numeric-indexed entries so JSON.stringify yields clean output.
            return result.rows.map((row: unknown) => {
              const obj: Record<string, unknown> = {};
              const rowObj = row as Record<string, unknown>;
              for (const col of result.columns) obj[col] = rowObj[col];
              return obj;
            });
          }
        };
      },
      close(): void {
        client.close();
      }
    };
  }
}
