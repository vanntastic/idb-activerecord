// Turso Direct Storage Adapter for Server & SSR Environments
// Allows ActiveRecord models to query Turso directly without IndexedDB.

import { StorageAdapter, StorageQuery, StoreOptions } from '../storage-adapter.js';
import { TursoClient, TursoStatement } from './turso-adapter.js';

interface LibsqlClient {
  execute(options: { sql: string; args?: unknown[] }): Promise<{
    rows: unknown[];
    rowsAffected: number;
    lastInsertRowid?: number;
    columns: string[];
  }>;
  batch?(
    statements: Array<{ sql: string; args?: unknown[] }>,
    mode?: 'write' | 'read' | 'deferred'
  ): Promise<unknown[]>;
  close?(): void;
}

export interface TursoStorageAdapterConfig {
  client?: LibsqlClient | TursoClient;
}

const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export class TursoStorageAdapter implements StorageAdapter {
  private client?: TursoClient;
  private rawClient?: LibsqlClient;
  private connected = false;

  constructor(private config: TursoStorageAdapterConfig) {
    if (config?.client) {
      if (typeof (config.client as TursoClient).prepare === 'function') {
        this.client = config.client as TursoClient;
      } else {
        this.rawClient = config.client as LibsqlClient;
        this.client = this.shimLibsqlClient(this.rawClient);
      }
    }
  }

  async connect(): Promise<void> {
    if (!this.client) {
      if (!this.config?.client) {
        throw new Error(
          'TursoStorageAdapter requires a `client` option. Pass a connected @libsql/client instance.'
        );
      }
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.rawClient?.close) {
      this.rawClient.close();
    } else if (this.client?.close) {
      await this.client.close();
    }
    this.connected = false;
  }

  private requireConnected(): void {
    if (!this.connected && !this.client) {
      throw new Error('TursoStorageAdapter not connected. Call connect() first.');
    }
  }

  private identifier(name: string): string {
    if (typeof name !== 'string' || !SAFE_IDENTIFIER.test(name)) {
      throw new Error(`Invalid SQL identifier: ${String(name)}`);
    }
    return `"${name}"`;
  }

  private async exec(sql: string, params: unknown[] = []): Promise<void> {
    this.requireConnected();
    const stmt = this.client!.prepare(sql);
    await Promise.resolve(stmt.run(...params));
  }

  private async queryAll<R>(sql: string, params: unknown[] = []): Promise<R[]> {
    this.requireConnected();
    const stmt = this.client!.prepare(sql);
    const rows = await Promise.resolve(stmt.all(...params));
    return rows as R[];
  }

  async ensureStore(tableName: string, options: StoreOptions = {}): Promise<void> {
    this.requireConnected();
    const safeTable = this.identifier(tableName);

    // Check if table exists
    const existing = await this.queryAll<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
      [tableName]
    );

    if (existing.length === 0) {
      const colParts: string[] = ['"id" TEXT PRIMARY KEY'];
      if (options.columns) {
        for (const col of options.columns) {
          if (col.name === 'id') continue;
          colParts.push(this.columnSql(col.name, col.type, col.nullable, col.default));
        }
      }
      // Ensure sync metadata columns exist
      const knownCols = new Set(options.columns?.map(c => c.name) ?? []);
      if (!knownCols.has('createdAt')) colParts.push('"createdAt" TEXT');
      if (!knownCols.has('updatedAt')) colParts.push('"updatedAt" TEXT');
      if (!knownCols.has('_version')) colParts.push('"_version" INTEGER DEFAULT 1');
      if (!knownCols.has('_deletedAt')) colParts.push('"_deletedAt" TEXT');

      await this.exec(`CREATE TABLE ${safeTable} (\n  ${colParts.join(',\n  ')}\n)`);
    } else {
      // Add missing columns if any
      const info = await this.queryAll<{ name: string }>(
        `PRAGMA table_info(${safeTable})`
      );
      const have = new Set(info.map(r => r.name));
      if (options.columns) {
        for (const col of options.columns) {
          if (!have.has(col.name)) {
            await this.exec(
              `ALTER TABLE ${safeTable} ADD COLUMN ${this.columnSql(
                col.name,
                col.type,
                col.nullable,
                col.default
              )}`
            );
          }
        }
      }
    }

    // Create declared indexes
    if (options.indexes && options.indexes.length > 0) {
      for (const idx of options.indexes) {
        const cols = Array.isArray(idx.keyPath) ? idx.keyPath : [idx.keyPath];
        for (const col of cols) {
          if (!SAFE_IDENTIFIER.test(col)) {
            throw new Error(`Invalid index column name: ${col}`);
          }
        }
        const indexName = idx.name && SAFE_IDENTIFIER.test(idx.name)
          ? idx.name
          : `idx_${tableName}_${cols.join('_')}`;
        if (!SAFE_IDENTIFIER.test(indexName)) {
          throw new Error(`Invalid index name: ${indexName}`);
        }
        const unique = idx.unique ? 'UNIQUE ' : '';
        const indexSql = `CREATE ${unique}INDEX IF NOT EXISTS ${this.identifier(
          indexName
        )} ON ${safeTable} (${cols.map(c => this.identifier(c)).join(', ')})`;
        await this.exec(indexSql);
      }
    }
  }

  private columnSql(
    name: string,
    type: string,
    nullable = true,
    defaultValue?: unknown
  ): string {
    let sqlType = 'TEXT';
    const lower = (type || 'string').toLowerCase();
    if (lower === 'integer' || lower === 'number') sqlType = 'INTEGER';
    else if (lower === 'real' || lower === 'float') sqlType = 'REAL';
    else if (lower === 'boolean') sqlType = 'BOOLEAN';
    else if (lower === 'json' || lower === 'array' || lower === 'object') sqlType = 'JSON';

    const parts = [`${this.identifier(name)} ${sqlType}`];
    if (!nullable) parts.push('NOT NULL');
    if (defaultValue !== undefined) {
      if (defaultValue === null) parts.push('DEFAULT NULL');
      else if (typeof defaultValue === 'number') parts.push(`DEFAULT ${defaultValue}`);
      else if (typeof defaultValue === 'boolean') parts.push(`DEFAULT ${defaultValue ? 1 : 0}`);
      else parts.push(`DEFAULT '${String(defaultValue).replace(/'/g, "''")}'`);
    }
    return parts.join(' ');
  }

  async get<T = any>(tableName: string, id: IDBValidKey): Promise<T | null> {
    this.requireConnected();
    const safeTable = this.identifier(tableName);
    const rows = await this.queryAll<Record<string, unknown>>(
      `SELECT * FROM ${safeTable} WHERE id = ? LIMIT 1`,
      [id]
    );
    if (rows.length === 0) return null;
    const deserialized = await this.deserializeRows(tableName, rows);
    return deserialized[0] as T;
  }

  async getAll<T = any>(tableName: string, query?: StorageQuery): Promise<T[]> {
    this.requireConnected();
    const safeTable = this.identifier(tableName);
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (!query?.includeDeleted) {
      conditions.push(`(_deletedAt IS NULL OR _deletedAt = '')`);
    }

    if (query?.where && query.where.length > 0) {
      for (const cond of query.where) {
        const safeCol = this.identifier(cond.field);
        switch (cond.operator) {
          case '=':
            conditions.push(`${safeCol} = ?`);
            params.push(cond.value);
            break;
          case '!=':
            conditions.push(`${safeCol} != ?`);
            params.push(cond.value);
            break;
          case '>':
            conditions.push(`${safeCol} > ?`);
            params.push(cond.value);
            break;
          case '>=':
            conditions.push(`${safeCol} >= ?`);
            params.push(cond.value);
            break;
          case '<':
            conditions.push(`${safeCol} < ?`);
            params.push(cond.value);
            break;
          case '<=':
            conditions.push(`${safeCol} <= ?`);
            params.push(cond.value);
            break;
          case 'like':
            conditions.push(`${safeCol} LIKE ?`);
            params.push(`%${String(cond.value).replace(/%/g, '')}%`);
            break;
          default:
            conditions.push(`${safeCol} = ?`);
            params.push(cond.value);
            break;
        }
      }
    }

    let sql = `SELECT * FROM ${safeTable}`;
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    if (query?.orderBy) {
      const dir = query.orderBy.direction === 'desc' ? 'DESC' : 'ASC';
      sql += ` ORDER BY ${this.identifier(query.orderBy.field)} ${dir}`;
    }

    if (query?.limit !== undefined) {
      sql += ` LIMIT ${Number(query.limit)}`;
    }
    if (query?.offset !== undefined) {
      sql += ` OFFSET ${Number(query.offset)}`;
    }

    const rows = await this.queryAll<Record<string, unknown>>(sql, params);
    return (await this.deserializeRows(tableName, rows)) as T[];
  }

  async put<T = any>(tableName: string, record: T): Promise<T> {
    this.requireConnected();
    const safeTable = this.identifier(tableName);
    const data = record as Record<string, unknown>;

    // Discover table columns
    const info = await this.queryAll<{ name: string; type: string }>(
      `PRAGMA table_info(${safeTable})`
    );
    let colNames = info.map(r => r.name);

    // If table doesn't exist yet, auto-provision
    if (colNames.length === 0) {
      const keys = Object.keys(data).filter(k => SAFE_IDENTIFIER.test(k));
      const colDefs = keys
        .filter(k => k !== 'id')
        .map(k => {
          const val = data[k];
          let type = 'string';
          if (typeof val === 'number') type = 'integer';
          else if (typeof val === 'boolean') type = 'boolean';
          else if (Array.isArray(val) || (typeof val === 'object' && val !== null)) type = 'json';
          return { name: k, type, nullable: true };
        });
      await this.ensureStore(tableName, { columns: colDefs });
      const updatedInfo = await this.queryAll<{ name: string; type: string }>(
        `PRAGMA table_info(${safeTable})`
      );
      colNames = updatedInfo.map(r => r.name);
    }

    // Check if new fields need ALTER TABLE ADD COLUMN
    for (const key of Object.keys(data)) {
      if (SAFE_IDENTIFIER.test(key) && !colNames.includes(key)) {
        const val = data[key];
        let type = 'TEXT';
        if (typeof val === 'number') type = 'INTEGER';
        else if (typeof val === 'boolean') type = 'BOOLEAN';
        else if (Array.isArray(val) || (typeof val === 'object' && val !== null)) type = 'JSON';
        await this.exec(`ALTER TABLE ${safeTable} ADD COLUMN ${this.identifier(key)} ${type}`);
        colNames.push(key);
      }
    }

    const validCols = Object.keys(data).filter(k => colNames.includes(k) && SAFE_IDENTIFIER.test(k));
    if (!validCols.includes('id') && data.id !== undefined) {
      validCols.unshift('id');
    }

    const values = validCols.map(c => this.serializeValue(data[c]));
    const placeholders = validCols.map(() => '?').join(', ');
    const updateClauses = validCols
      .filter(c => c !== 'id')
      .map(c => `${this.identifier(c)} = excluded.${this.identifier(c)}`)
      .join(', ');

    let sql: string;
    if (updateClauses.length > 0) {
      sql = `INSERT INTO ${safeTable} (${validCols.map(c => this.identifier(c)).join(', ')})
             VALUES (${placeholders})
             ON CONFLICT(id) DO UPDATE SET ${updateClauses}`;
    } else {
      sql = `INSERT INTO ${safeTable} (${validCols.map(c => this.identifier(c)).join(', ')})
             VALUES (${placeholders})
             ON CONFLICT(id) DO NOTHING`;
    }

    await this.exec(sql, values);
    return record;
  }

  async delete(tableName: string, id: IDBValidKey): Promise<boolean> {
    this.requireConnected();
    const safeTable = this.identifier(tableName);
    await this.exec(`DELETE FROM ${safeTable} WHERE id = ?`, [id]);
    return true;
  }

  async clear(tableName: string): Promise<void> {
    this.requireConnected();
    const safeTable = this.identifier(tableName);
    await this.exec(`DELETE FROM ${safeTable}`);
  }

  async transaction<R>(
    _tableNames: string[],
    _mode: 'readonly' | 'readwrite',
    callback: () => Promise<R>
  ): Promise<R> {
    this.requireConnected();
    await this.exec('BEGIN');
    try {
      const result = await callback();
      await this.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        await this.exec('ROLLBACK');
      } catch {
        // ignore rollback errors
      }
      throw err;
    }
  }

  private serializeValue(v: unknown): unknown {
    if (v === undefined || v === null) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v) || (typeof v === 'object' && v !== null)) {
      return JSON.stringify(v);
    }
    return v;
  }

  private async deserializeRows(
    tableName: string,
    rows: Record<string, unknown>[]
  ): Promise<Record<string, unknown>[]> {
    if (rows.length === 0) return rows;
    const safeTable = this.identifier(tableName);
    const info = await this.queryAll<{ name: string; type: string }>(
      `PRAGMA table_info(${safeTable})`
    );
    const jsonCols = new Set(
      info.filter(c => (c.type || '').toUpperCase() === 'JSON').map(c => c.name)
    );
    const boolCols = new Set(
      info.filter(c => (c.type || '').toUpperCase() === 'BOOLEAN').map(c => c.name)
    );

    return rows.map(row => {
      const item: Record<string, unknown> = { ...row };
      for (const col of jsonCols) {
        if (item[col] !== null && typeof item[col] === 'string') {
          try {
            item[col] = JSON.parse(item[col] as string);
          } catch {
            // keep raw string
          }
        }
      }
      for (const col of boolCols) {
        if (item[col] !== null && item[col] !== undefined) {
          item[col] = Boolean(item[col]);
        }
      }
      return item;
    });
  }

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
        client.close?.();
      }
    };
  }
}
