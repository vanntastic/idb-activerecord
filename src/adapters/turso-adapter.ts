// Turso (libSQL / SQLite) Sync Adapter
// Talks directly to a Turso/libSQL/SQLite database via a prepared-statement
// client (e.g. `@tursodatabase/database`, `@libsql/client`, `better-sqlite3`).
//
// The user is responsible for providing a connected client via `connect({ client })`.
// This keeps the adapter dependency-free and lets the caller pick the runtime
// (Node, browser WASM, edge) appropriate for their app.

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
 * `.all()` methods (sync or async).
 */
export interface TursoClient {
  prepare(sql: string): TursoStatement;
  close?(): void | Promise<void>;
}

export interface TursoStatement {
  run(...args: unknown[]): unknown | Promise<unknown>;
  all(...args: unknown[]): unknown[] | Promise<unknown[]>;
}

export interface TursoAdapterConfig extends AdapterConfig {
  /** A connected Turso/libSQL/SQLite client. Required. */
  client: TursoClient;
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
 * import { connect } from '@tursodatabase/database';
 * import { TursoAdapter } from 'idb-activerecord';
 *
 * const client = await connect('libsql://my-db.turso.io', { authToken });
 * const adapter = new TursoAdapter();
 * await adapter.connect({ client });
 *
 * db.enableAutoSync(adapter, { debounceMs: 500 });
 * ```
 */
export class TursoAdapter extends BaseAdapter {
  private client!: TursoClient;

  async connect(config: TursoAdapterConfig): Promise<void> {
    if (!config || !config.client) {
      throw new Error(
        'TursoAdapter.connect() requires a connected client (config.client). ' +
        'Create one with `await connect(...)` from your Turso/libSQL driver first.'
      );
    }
    this.config = config;
    this.client = config.client;
    this.connected = true;
    this.updateState({ status: SyncStatus.IDLE });
  }

  async disconnect(): Promise<void> {
    if (this.client && this.client.close) {
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
    const now = new Date().toISOString();
    const defaultOwnerId =
      (this.config as TursoAdapterConfig).defaultOwnerId ?? 'demo';

    try {
      const first = records[0]!;
      const RecordClass = first.constructor as typeof ActiveRecord;
      const table =
        options.table ||
        (RecordClass as unknown as { tableName?: string }).tableName;
      if (!table) throw new Error('Cannot push records without tableName');

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
    const stmt = this.client.prepare(sql);
    await Promise.resolve(stmt.run(...params));
  }

  private async queryAll<R>(
    sql: string,
    params: unknown[] = []
  ): Promise<R[]> {
    const stmt = this.client.prepare(sql);
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
}
