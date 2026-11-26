// SQLite & Turso DDL Exporter
// Produces deterministic, production-ready CREATE TABLE IF NOT EXISTS and
// CREATE [UNIQUE] INDEX IF NOT EXISTS statements matching TursoAdapter conventions.

import type { Database } from './database.js';
import type { ActiveRecord } from './activerecord.js';
import type { TableSchema, ColumnDef, IndexDef } from './sync-adapter.js';
import type { ERDDocument } from './erd.js';

export interface SchemaExportOptions {
  /** Include sync metadata columns: updatedAt, version, deleted_at, owner_id */
  syncColumns?: boolean;
  /** Emit IF NOT EXISTS clause (default: true) */
  ifNotExists?: boolean;
  /** Target export format (default: 'sqlite') */
  format?: 'sqlite' | 'turso' | 'json';
}

const IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Validate that an identifier is safe for SQL statements (CodeQL safe).
 */
export function assertIdentifier(name: string, kind = 'identifier'): void {
  if (!name || typeof name !== 'string' || !IDENTIFIER_REGEX.test(name)) {
    throw new Error(
      `Invalid ${kind}: "${name}". SQL identifiers must match /^[a-zA-Z_][a-zA-Z0-9_]*$/`
    );
  }
}

/**
 * Quote an identifier with double quotes after validating it.
 */
export function quoteIdentifier(name: string, kind = 'identifier'): string {
  assertIdentifier(name, kind);
  return `"${name}"`;
}

/**
 * Map an ORM/ERD type string to SQLite/Turso storage type.
 * Matches TursoAdapter's type mapping: INTEGER, BOOLEAN, REAL, JSON, TEXT.
 */
export function toSqliteType(t: string | undefined): string {
  switch ((t ?? 'string').toLowerCase()) {
    case 'integer':
    case 'int':
      return 'INTEGER';
    case 'boolean':
    case 'bool':
      return 'BOOLEAN';
    case 'real':
    case 'float':
    case 'double':
    case 'number':
      return 'REAL';
    case 'json':
    case 'array':
    case 'object':
      return 'JSON';
    case 'datetime':
    case 'date':
    case 'timestamp':
    case 'string':
    case 'text':
    default:
      return 'TEXT';
  }
}

/**
 * Format a default value into SQL literal syntax.
 */
export function formatDefault(v: unknown): string {
  if (v === null) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * Sync metadata columns matching TursoAdapter and SyncEngine.
 */
export const SYNC_METADATA_COLUMNS: ColumnDef[] = [
  { name: 'id', type: 'string', nullable: false, primaryKey: true },
  { name: 'updatedAt', type: 'datetime', nullable: false, default: '' },
  { name: 'version', type: 'integer', nullable: false, default: 1 },
  { name: 'deleted_at', type: 'datetime', nullable: true },
  { name: 'owner_id', type: 'string', nullable: true, default: 'demo' }
];

/**
 * Convert a ColumnDef to a SQL column definition string.
 */
export function columnToSql(col: ColumnDef): string {
  const safeName = quoteIdentifier(col.name, 'column name');
  const sqlType = toSqliteType(col.type);
  const parts = [`${safeName} ${sqlType}`];
  if (col.primaryKey) parts.push('PRIMARY KEY');
  if (col.autoIncrement) parts.push('AUTOINCREMENT');
  if (col.nullable === false) parts.push('NOT NULL');
  if (col.default !== undefined) {
    parts.push(`DEFAULT ${formatDefault(col.default)}`);
  }
  return parts.join(' ');
}

/**
 * Check if the input is an ERDDocument.
 */
function isERDDocument(input: unknown): input is ERDDocument {
  return (
    typeof input === 'object' &&
    input !== null &&
    'entities' in input &&
    Array.isArray((input as ERDDocument).entities)
  );
}

/**
 * Check if the input is a Database instance.
 */
function isDatabase(input: unknown): input is Database {
  if (typeof input !== 'object' || input === null) return false;
  const anyInput = input as any;
  return (
    typeof anyInput.getModels === 'function' ||
    (anyInput.models instanceof Map) ||
    anyInput.constructor?.name === 'Database'
  );
}

/**
 * Introspect an ActiveRecord model class into a TableSchema.
 */
export function modelToTableSchema(
  model: typeof ActiveRecord,
  options?: SchemaExportOptions
): TableSchema {
  const tableName =
    model.tableName || (model.name ? model.name.toLowerCase() + 's' : 'records');
  assertIdentifier(tableName, 'table name');

  const declared = model.getColumnDefs ? model.getColumnDefs() : null;
  const colMap = new Map<string, ColumnDef>();

  if (declared && Array.isArray(declared)) {
    for (const c of declared) {
      assertIdentifier(c.name, 'column name');
      colMap.set(c.name, {
        name: c.name,
        type: c.type ?? 'string',
        nullable: c.nullable ?? true,
        ...(c.default !== undefined ? { default: c.default } : {}),
        ...(c.primaryKey ? { primaryKey: true } : {}),
        ...(c.autoIncrement ? { autoIncrement: true } : {})
      });
    }
  } else if (model.columns && typeof model.columns === 'object') {
    if (Array.isArray(model.columns)) {
      for (const c of model.columns) {
        assertIdentifier(c.name, 'column name');
        colMap.set(c.name, {
          name: c.name,
          type: c.type ?? 'string',
          nullable: c.nullable ?? true,
          ...(c.default !== undefined ? { default: c.default } : {}),
          ...(c.primaryKey ? { primaryKey: true } : {}),
          ...(c.autoIncrement ? { autoIncrement: true } : {})
        });
      }
    } else {
      for (const [colName, def] of Object.entries(model.columns)) {
        assertIdentifier(colName, 'column name');
        const d = def as any;
        colMap.set(colName, {
          name: colName,
          type: d.type ?? 'string',
          nullable: d.nullable ?? true,
          ...(d.default !== undefined ? { default: d.default } : {}),
          ...(d.primaryKey ? { primaryKey: true } : {}),
          ...(d.autoIncrement ? { autoIncrement: true } : {})
        });
      }
    }
  }

  // Ensure primary key `id` exists
  if (!colMap.has('id')) {
    colMap.set('id', {
      name: 'id',
      type: 'string',
      nullable: false,
      primaryKey: true
    });
  } else {
    const idCol = colMap.get('id')!;
    idCol.primaryKey = true;
    idCol.nullable = false;
  }

  // Add soft delete column if enabled
  if (model.isSoftDeleteEnabled && !colMap.has('_deletedAt')) {
    colMap.set('_deletedAt', {
      name: '_deletedAt',
      type: 'datetime',
      nullable: true
    });
  }

  // Add timestamps if enabled
  if ((model as any).timestamps) {
    if (!colMap.has('createdAt')) {
      colMap.set('createdAt', {
        name: 'createdAt',
        type: 'datetime',
        nullable: true
      });
    }
    if (!colMap.has('updatedAt')) {
      colMap.set('updatedAt', {
        name: 'updatedAt',
        type: 'datetime',
        nullable: true
      });
    }
  }

  // Add versioning if enabled
  if ((model as any).versioning && !colMap.has('_version')) {
    colMap.set('_version', {
      name: '_version',
      type: 'integer',
      nullable: false,
      default: 1
    });
  }

  // Add sync metadata columns if model enables sync or syncColumns option is requested
  const shouldSync = options?.syncColumns || model.isSyncEnabled;
  if (shouldSync) {
    for (const meta of SYNC_METADATA_COLUMNS) {
      if (!colMap.has(meta.name)) {
        colMap.set(meta.name, { ...meta });
      }
    }
  }

  // Process indexes
  const indexes: IndexDef[] = [];
  const rawIndexes = (model as any).indexes;
  if (Array.isArray(rawIndexes)) {
    for (const idx of rawIndexes) {
      if (!idx.columns || !Array.isArray(idx.columns) || idx.columns.length === 0) continue;
      for (const col of idx.columns) {
        assertIdentifier(col, 'index column name');
      }
      const idxName = idx.name || `idx_${tableName}_${idx.columns.join('_')}`;
      assertIdentifier(idxName, 'index name');
      indexes.push({
        name: idxName,
        columns: [...idx.columns],
        unique: Boolean(idx.unique)
      });
    }
  }

  // Deterministic columns: id first, then alphabetical by column name
  const columns: ColumnDef[] = [];
  if (colMap.has('id')) {
    columns.push(colMap.get('id')!);
    colMap.delete('id');
  }
  const remainingCols = Array.from(colMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  columns.push(...remainingCols);

  return {
    name: tableName,
    columns,
    indexes
  };
}

/**
 * Convert an ERDDocument into an array of TableSchemas.
 */
export function erdToTableSchemas(
  erd: ERDDocument,
  options?: SchemaExportOptions
): TableSchema[] {
  const schemas: TableSchema[] = [];

  for (const entity of erd.entities) {
    assertIdentifier(entity.name, 'entity table name');
    const colMap = new Map<string, ColumnDef>();

    for (const col of entity.columns) {
      assertIdentifier(col.name, 'column name');
      colMap.set(col.name, {
        name: col.name,
        type: col.type ?? 'string',
        nullable: col.nullable ?? (col.primaryKey ? false : true),
        ...(col.default !== undefined ? { default: col.default } : {}),
        ...(col.primaryKey ? { primaryKey: true } : {}),
        ...(col.unique ? { autoIncrement: false } : {})
      });
    }

    // Ensure id column
    if (!colMap.has('id')) {
      colMap.set('id', {
        name: 'id',
        type: 'string',
        nullable: false,
        primaryKey: true
      });
    }

    // Check entity sync/timestamp/soft-delete flags
    if (entity.softDelete && !colMap.has('_deletedAt')) {
      colMap.set('_deletedAt', {
        name: '_deletedAt',
        type: 'datetime',
        nullable: true
      });
    }

    if (entity.timestamps) {
      if (!colMap.has('createdAt')) {
        colMap.set('createdAt', { name: 'createdAt', type: 'datetime', nullable: true });
      }
      if (!colMap.has('updatedAt')) {
        colMap.set('updatedAt', { name: 'updatedAt', type: 'datetime', nullable: true });
      }
    }

    if (entity.versioning && !colMap.has('_version')) {
      colMap.set('_version', { name: '_version', type: 'integer', nullable: false, default: 1 });
    }

    const shouldSync = options?.syncColumns || entity.enableSync;
    if (shouldSync) {
      for (const meta of SYNC_METADATA_COLUMNS) {
        if (!colMap.has(meta.name)) {
          colMap.set(meta.name, { ...meta });
        }
      }
    }

    const indexes: IndexDef[] = [];
    if (Array.isArray(entity.indexes)) {
      for (const idx of entity.indexes) {
        if (!idx.columns || idx.columns.length === 0) continue;
        for (const col of idx.columns) {
          assertIdentifier(col, 'index column name');
        }
        const idxName = idx.name || `idx_${entity.name}_${idx.columns.join('_')}`;
        assertIdentifier(idxName, 'index name');
        indexes.push({
          name: idxName,
          columns: [...idx.columns],
          unique: Boolean(idx.unique)
        });
      }
    }

    // Also collect unique columns as unique indexes if not already present
    for (const col of entity.columns) {
      if (col.unique && !col.primaryKey) {
        const alreadyIndexed = indexes.some(
          idx => idx.columns.length === 1 && idx.columns[0] === col.name && idx.unique
        );
        if (!alreadyIndexed) {
          const idxName = `idx_${entity.name}_${col.name}`;
          assertIdentifier(idxName, 'index name');
          indexes.push({
            name: idxName,
            columns: [col.name],
            unique: true
          });
        }
      }
    }

    // Deterministic columns: id first, then sorted
    const columns: ColumnDef[] = [];
    if (colMap.has('id')) {
      columns.push(colMap.get('id')!);
      colMap.delete('id');
    }
    const remainingCols = Array.from(colMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    columns.push(...remainingCols);

    schemas.push({
      name: entity.name,
      columns,
      indexes
    });
  }

  // Sort tables alphabetically for deterministic output
  schemas.sort((a, b) => a.name.localeCompare(b.name));
  return schemas;
}

/**
 * Resolve any supported input into an array of TableSchemas.
 */
export function resolveToTableSchemas(
  input: Database | Array<typeof ActiveRecord> | ERDDocument,
  options?: SchemaExportOptions
): TableSchema[] {
  if (isERDDocument(input)) {
    return erdToTableSchemas(input, options);
  }

  if (isDatabase(input)) {
    const modelsMap: Map<string, typeof ActiveRecord> =
      typeof input.getModels === 'function'
        ? input.getModels()
        : (input as any).models;
    const models = Array.from(modelsMap.values());
    const schemas = models.map(m => modelToTableSchema(m, options));
    schemas.sort((a, b) => a.name.localeCompare(b.name));
    return schemas;
  }

  if (Array.isArray(input)) {
    const schemas = input.map(m => modelToTableSchema(m, options));
    schemas.sort((a, b) => a.name.localeCompare(b.name));
    return schemas;
  }

  throw new Error(
    'Invalid input to schema exporter: expected Database instance, array of ActiveRecord models, or ERDDocument'
  );
}

/**
 * Generate a deterministic SQL DDL string for a single TableSchema.
 */
export function tableSchemaToSQL(
  table: TableSchema,
  options: SchemaExportOptions = {}
): string {
  const safeTable = quoteIdentifier(table.name, 'table name');
  const ifNotExists = options.ifNotExists !== false ? 'IF NOT EXISTS ' : '';
  const parts: string[] = [];

  const colLines = table.columns.map(c => `  ${columnToSql(c)}`);
  parts.push(`CREATE TABLE ${ifNotExists}${safeTable} (\n${colLines.join(',\n')}\n);`);

  // Indexes (sorted deterministically by name)
  if (table.indexes && table.indexes.length > 0) {
    const sortedIndexes = [...table.indexes].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    for (const idx of sortedIndexes) {
      if (!idx.columns || idx.columns.length === 0) continue;
      for (const col of idx.columns) {
        assertIdentifier(col, 'index column name');
      }
      const indexName = idx.name || `idx_${table.name}_${idx.columns.join('_')}`;
      const safeIndexName = quoteIdentifier(indexName, 'index name');
      const unique = idx.unique ? 'UNIQUE ' : '';
      const colList = idx.columns.map(c => quoteIdentifier(c, 'index column')).join(', ');
      parts.push(
        `CREATE ${unique}INDEX ${ifNotExists}${safeIndexName} ON ${safeTable} (${colList});`
      );
    }
  }

  return parts.join('\n');
}

/**
 * Export schema to SQLite / Turso DDL statements.
 * Production-ready, deterministic CREATE TABLE IF NOT EXISTS and CREATE INDEX statements.
 */
export function exportSchemaToSQL(
  input: Database | Array<typeof ActiveRecord> | ERDDocument,
  options: SchemaExportOptions = {}
): string {
  if (options.format === 'json') {
    return exportSchemaToJSON(input, options);
  }

  const tables = resolveToTableSchemas(input, options);
  const sqlBlocks = tables.map(t => tableSchemaToSQL(t, options));
  return sqlBlocks.join('\n\n') + (sqlBlocks.length > 0 ? '\n' : '');
}

/**
 * Alias for exportSchemaToSQL.
 */
export const generateSqliteDDL = exportSchemaToSQL;

/**
 * Export structured schema to JSON format.
 */
export function exportSchemaToJSON(
  input: Database | Array<typeof ActiveRecord> | ERDDocument,
  options: SchemaExportOptions = {}
): string {
  const tables = resolveToTableSchemas(input, options);
  return JSON.stringify({ tables }, null, 2) + '\n';
}
