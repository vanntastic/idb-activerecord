// Bidirectional ERD Tooling for idb-activerecord
// Exported via subpath "idb-activerecord/erd" with 0 KB core bundle overhead.
// Never imported from src/index.ts.

import path from 'node:path';
import fs from 'node:fs';
import { singularize } from './activerecord.js';
import type { Database } from './database.js';
import type { ActiveRecord } from './activerecord.js';
import {
  exportSchemaToSQL,
  type SchemaExportOptions
} from './schema-export.js';

export interface ERDColumn {
  name: string;
  type: string;
  primaryKey?: boolean;
  foreignKey?: boolean;
  unique?: boolean;
  nullable?: boolean;
  default?: unknown;
  comment?: string;
}

export interface ERDIndex {
  name?: string;
  columns: string[];
  unique?: boolean;
}

export interface ERDEntity {
  name: string;
  className?: string;
  columns: ERDColumn[];
  indexes?: ERDIndex[];
  enableSync?: boolean;
  softDelete?: boolean;
  timestamps?: boolean;
  versioning?: boolean;
  comment?: string;
}

export type ERDRelationshipType = '1:1' | '1:N' | 'N:M' | 'N:1';

export interface ERDRelationship {
  from: string;
  to: string;
  type: ERDRelationshipType;
  via?: string;
  label?: string;
}

export interface ERDDocument {
  entities: ERDEntity[];
  relationships: ERDRelationship[];
  title?: string;
}

export interface GenerateModelsOptions {
  language?: 'typescript' | 'javascript';
  includeSync?: boolean;
  includeValidation?: boolean;
  outputDir?: string;
}

export interface WriteModelsOptions extends GenerateModelsOptions {
  outputDir: string;
  overwrite?: boolean;
}

/**
 * Helper to convert snake_case or table name into PascalCase class name.
 */
function toPascalCase(str: string): string {
  if (!str) return '';
  const parts = str.split(/[_\-\s]+/);
  return parts
    .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join('');
}

/**
 * Helper to convert table name into kebab-case singular filename.
 */
function toFilename(tableName: string, ext: 'ts' | 'js'): string {
  const singular = singularize(tableName);
  const kebab = singular
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
  return `${kebab}.${ext}`;
}

/**
 * Map ERD column type to TypeScript property type.
 */
function toTsType(type: string): string {
  switch ((type ?? 'string').toLowerCase()) {
    case 'integer':
    case 'int':
    case 'real':
    case 'float':
    case 'double':
    case 'number':
      return 'number';
    case 'boolean':
    case 'bool':
      return 'boolean';
    case 'datetime':
    case 'date':
    case 'timestamp':
      return 'Date | string';
    case 'json':
    case 'object':
      return 'Record<string, unknown>';
    case 'array':
      return 'unknown[]';
    case 'string':
    case 'text':
    default:
      return 'string';
  }
}

/**
 * Introspect a Database instance or array of ActiveRecord model classes into an ERDDocument.
 */
export function generateERD(
  dbOrModels: Database | Array<typeof ActiveRecord> | typeof ActiveRecord
): ERDDocument {
  const models: Array<typeof ActiveRecord> = [];

  if (Array.isArray(dbOrModels)) {
    models.push(...dbOrModels);
  } else if (typeof dbOrModels === 'object' && dbOrModels !== null) {
    const anyDb = dbOrModels as any;
    if (typeof anyDb.getModels === 'function') {
      models.push(...Array.from((anyDb.getModels() as Map<string, typeof ActiveRecord>).values()));
    } else if (anyDb.models instanceof Map) {
      models.push(...Array.from((anyDb.models as Map<string, typeof ActiveRecord>).values()));
    }
  } else if (typeof dbOrModels === 'function') {
    models.push(dbOrModels as typeof ActiveRecord);
  }

  const entities: ERDEntity[] = [];
  const relationships: ERDRelationship[] = [];
  const modelByTable = new Map<string, typeof ActiveRecord>();

  for (const m of models) {
    const tableName = m.tableName || (m.name ? m.name.toLowerCase() + 's' : 'records');
    modelByTable.set(tableName, m);
    if (m.name) modelByTable.set(m.name, m);
  }

  for (const m of models) {
    const tableName = m.tableName || (m.name ? m.name.toLowerCase() + 's' : 'records');
    const className = m.name || toPascalCase(singularize(tableName));
    const declaredCols = m.getColumnDefs ? m.getColumnDefs() : null;
    const colList: ERDColumn[] = [];
    const seenCols = new Set<string>();

    if (declaredCols && Array.isArray(declaredCols)) {
      for (const c of declaredCols) {
        seenCols.add(c.name);
        colList.push({
          name: c.name,
          type: c.type ?? 'string',
          primaryKey: Boolean(c.primaryKey),
          nullable: c.nullable ?? true,
          ...(c.default !== undefined ? { default: c.default } : {})
        });
      }
    } else if (m.columns && typeof m.columns === 'object') {
      if (Array.isArray(m.columns)) {
        for (const c of m.columns) {
          seenCols.add(c.name);
          colList.push({
            name: c.name,
            type: c.type ?? 'string',
            primaryKey: Boolean(c.primaryKey),
            nullable: c.nullable ?? true,
            ...(c.default !== undefined ? { default: c.default } : {})
          });
        }
      } else {
        for (const [name, def] of Object.entries(m.columns)) {
          seenCols.add(name);
          const d = def as any;
          colList.push({
            name,
            type: d.type ?? 'string',
            primaryKey: Boolean(d.primaryKey),
            nullable: d.nullable ?? true,
            ...(d.default !== undefined ? { default: d.default } : {})
          });
        }
      }
    }

    // Ensure id column
    if (!seenCols.has('id')) {
      colList.unshift({
        name: 'id',
        type: 'string',
        primaryKey: true,
        nullable: false
      });
      seenCols.add('id');
    }

    // Check soft delete
    const isSoftDelete = Boolean(m.isSoftDeleteEnabled);
    if (isSoftDelete && !seenCols.has('_deletedAt')) {
      colList.push({
        name: '_deletedAt',
        type: 'datetime',
        nullable: true
      });
      seenCols.add('_deletedAt');
    }

    // Check timestamps
    const hasTimestamps = Boolean((m as any).timestamps);
    if (hasTimestamps) {
      if (!seenCols.has('createdAt')) {
        colList.push({ name: 'createdAt', type: 'datetime', nullable: true });
        seenCols.add('createdAt');
      }
      if (!seenCols.has('updatedAt')) {
        colList.push({ name: 'updatedAt', type: 'datetime', nullable: true });
        seenCols.add('updatedAt');
      }
    }

    // Check versioning
    const hasVersioning = Boolean((m as any).versioning);
    if (hasVersioning && !seenCols.has('_version')) {
      colList.push({ name: '_version', type: 'integer', nullable: false, default: 1 });
      seenCols.add('_version');
    }

    // Check indexes
    const indexes: ERDIndex[] = [];
    const rawIndexes = (m as any).indexes;
    if (Array.isArray(rawIndexes)) {
      for (const idx of rawIndexes) {
        if (!idx.columns || idx.columns.length === 0) continue;
        indexes.push({
          name: idx.name,
          columns: [...idx.columns],
          unique: Boolean(idx.unique)
        });
        if (idx.unique && idx.columns.length === 1) {
          const col = colList.find(c => c.name === idx.columns[0]);
          if (col) col.unique = true;
        }
      }
    }

    // Relationships: hasMany, hasOne, belongsTo
    const hasMany = (m as any).hasMany;
    if (hasMany && typeof hasMany === 'object') {
      for (const [relKey, target] of Object.entries(hasMany)) {
        let targetTable = '';
        let foreignKey = '';
        if (typeof target === 'string') {
          targetTable = target;
          foreignKey = `${singularize(tableName)}Id`;
        } else if (typeof target === 'function') {
          targetTable = (target as any).tableName || `${target.name.toLowerCase()}s`;
          foreignKey = `${singularize(tableName)}Id`;
        } else if (typeof target === 'object' && target !== null) {
          const tgt = target as any;
          targetTable =
            typeof tgt.model === 'function'
              ? tgt.model.tableName || `${tgt.model.name.toLowerCase()}s`
              : String(tgt.model || relKey);
          foreignKey = tgt.foreignKey || `${singularize(tableName)}Id`;
        }
        if (targetTable) {
          relationships.push({
            from: tableName,
            to: targetTable,
            type: '1:N',
            via: foreignKey,
            label: 'has many'
          });
        }
      }
    }

    const hasOne = (m as any).hasOne;
    if (hasOne && typeof hasOne === 'object') {
      for (const [relKey, target] of Object.entries(hasOne)) {
        let targetTable = '';
        let foreignKey = '';
        if (typeof target === 'string') {
          targetTable = target;
          foreignKey = `${singularize(tableName)}Id`;
        } else if (typeof target === 'function') {
          targetTable = (target as any).tableName || `${target.name.toLowerCase()}s`;
          foreignKey = `${singularize(tableName)}Id`;
        } else if (typeof target === 'object' && target !== null) {
          const tgt = target as any;
          targetTable =
            typeof tgt.model === 'function'
              ? tgt.model.tableName || `${tgt.model.name.toLowerCase()}s`
              : String(tgt.model || relKey);
          foreignKey = tgt.foreignKey || `${singularize(tableName)}Id`;
        }
        if (targetTable) {
          relationships.push({
            from: tableName,
            to: targetTable,
            type: '1:1',
            via: foreignKey,
            label: 'has one'
          });
        }
      }
    }

    const belongsTo = (m as any).belongsTo;
    if (belongsTo && typeof belongsTo === 'object') {
      for (const [relKey, target] of Object.entries(belongsTo)) {
        let targetTable = '';
        let foreignKey = '';
        if (typeof target === 'string') {
          targetTable = target;
          foreignKey = `${singularize(relKey)}Id`;
        } else if (typeof target === 'function') {
          targetTable = (target as any).tableName || `${target.name.toLowerCase()}s`;
          foreignKey = `${singularize(relKey)}Id`;
        } else if (typeof target === 'object' && target !== null) {
          const tgt = target as any;
          targetTable =
            typeof tgt.model === 'function'
              ? tgt.model.tableName || `${tgt.model.name.toLowerCase()}s`
              : String(tgt.model || relKey);
          foreignKey = tgt.foreignKey || `${singularize(relKey)}Id`;
        }

        // Mark foreign key on this entity's columns
        if (foreignKey) {
          let fkCol = colList.find(c => c.name === foreignKey);
          if (!fkCol) {
            fkCol = { name: foreignKey, type: 'string', foreignKey: true, nullable: true };
            colList.push(fkCol);
            seenCols.add(foreignKey);
          } else {
            fkCol.foreignKey = true;
          }
        }

        // Only add if not already captured in opposite direction
        const alreadyCaptured = relationships.some(
          r => r.from === targetTable && r.to === tableName && r.via === foreignKey
        );
        if (!alreadyCaptured && targetTable) {
          relationships.push({
            from: targetTable,
            to: tableName,
            type: '1:N',
            via: foreignKey,
            label: 'belongs to'
          });
        }
      }
    }

    entities.push({
      name: tableName,
      className,
      columns: colList,
      indexes,
      enableSync: Boolean(m.isSyncEnabled),
      softDelete: isSoftDelete,
      timestamps: hasTimestamps,
      versioning: hasVersioning
    });
  }

  // Sort entities deterministically
  entities.sort((a, b) => a.name.localeCompare(b.name));

  return {
    entities,
    relationships
  };
}

/**
 * Export an ERDDocument to valid Mermaid.js erDiagram syntax.
 */
export function exportToMermaid(erd: ERDDocument): string {
  const lines: string[] = ['erDiagram'];

  // Entities
  for (const entity of erd.entities) {
    lines.push(`    ${entity.name} {`);
    for (const col of entity.columns) {
      const parts: string[] = [`        ${col.type} ${col.name}`];
      if (col.primaryKey) parts.push('PK');
      if (col.foreignKey) parts.push('FK');
      if (col.unique && !col.primaryKey) parts.push('UK');
      if (col.comment) parts.push(`"${col.comment.replace(/"/g, "'")}"`);
      lines.push(parts.join(' '));
    }
    lines.push('    }');
  }

  // Relationships
  for (const rel of erd.relationships) {
    let cardSymbol = '||--o{';
    switch (rel.type) {
      case '1:1':
        cardSymbol = '||--||';
        break;
      case 'N:M':
        cardSymbol = '}o--o{';
        break;
      case 'N:1':
        cardSymbol = '}o--||';
        break;
      case '1:N':
      default:
        cardSymbol = '||--o{';
        break;
    }
    const label = rel.via || rel.label || '';
    lines.push(`    ${rel.from} ${cardSymbol} ${rel.to} : "${label}"`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Export an ERDDocument to valid PlantUML @startuml ... @enduml syntax.
 */
export function exportToPlantUML(erd: ERDDocument): string {
  const lines: string[] = [
    '@startuml',
    'hide circle',
    'skinparam linetype ortho',
    ''
  ];

  for (const entity of erd.entities) {
    lines.push(`entity "${entity.name}" as ${entity.name} {`);
    const pkCols = entity.columns.filter(c => c.primaryKey);
    const nonPkCols = entity.columns.filter(c => !c.primaryKey);

    for (const pk of pkCols) {
      lines.push(`  * ${pk.name} : ${pk.type} <<PK>>`);
    }
    if (pkCols.length > 0 && nonPkCols.length > 0) {
      lines.push('  --');
    }
    for (const col of nonPkCols) {
      const prefix = col.nullable === false ? '* ' : '';
      const tags: string[] = [];
      if (col.foreignKey) tags.push('<<FK>>');
      if (col.unique) tags.push('<<UK>>');
      const tagStr = tags.length > 0 ? ` ${tags.join(' ')}` : '';
      lines.push(`  ${prefix}${col.name} : ${col.type}${tagStr}`);
    }
    lines.push('}');
    lines.push('');
  }

  for (const rel of erd.relationships) {
    let cardSymbol = '||--o{';
    switch (rel.type) {
      case '1:1':
        cardSymbol = '||--||';
        break;
      case 'N:M':
        cardSymbol = '}o--o{';
        break;
      case 'N:1':
        cardSymbol = '}o--||';
        break;
      case '1:N':
      default:
        cardSymbol = '||--o{';
        break;
    }
    const label = rel.via || rel.label || '';
    lines.push(`${rel.from} ${cardSymbol} ${rel.to} : "${label}"`);
  }

  lines.push('@enduml');
  return lines.join('\n') + '\n';
}

/**
 * Export an ERDDocument to SQLite/Turso DDL statements.
 */
export function exportToSQL(
  erd: ERDDocument,
  options?: SchemaExportOptions
): string {
  return exportSchemaToSQL(erd, options);
}

/**
 * Parse Mermaid erDiagram syntax into an ERDDocument.
 *
 * Implements a strict linear-time, line-by-line parser without nested quantifiers
 * or backtracking regular expressions to ensure 100% CodeQL ReDoS safety.
 */
export function parseMermaid(mermaidText: string): ERDDocument {
  const entities: ERDEntity[] = [];
  const entityMap = new Map<string, ERDEntity>();
  const relationships: ERDRelationship[] = [];

  const lines = mermaidText.split(/\r?\n/);
  let currentEntity: ERDEntity | null = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;
    if (rawLine.startsWith('%%')) continue;
    if (rawLine === 'erDiagram' || rawLine.startsWith('erDiagram ')) continue;

    // Check if closing entity block
    if (currentEntity && rawLine.startsWith('}')) {
      currentEntity = null;
      continue;
    }

    // Inside entity block
    if (currentEntity) {
      // Parse column line: <type> <name> [PK] [FK] [UK] ["comment"]
      let lineWithoutComment = rawLine;
      let comment: string | undefined;

      const firstQuote = rawLine.indexOf('"');
      if (firstQuote !== -1) {
        const lastQuote = rawLine.lastIndexOf('"');
        if (lastQuote > firstQuote) {
          comment = rawLine.slice(firstQuote + 1, lastQuote);
          lineWithoutComment = rawLine.slice(0, firstQuote).trim();
        }
      }

      // Split non-empty whitespace tokens
      const tokens = lineWithoutComment.split(/\s+/).filter(Boolean);
      if (tokens.length >= 2) {
        const type = tokens[0];
        const name = tokens[1];
        const flags = tokens.slice(2).map(t => t.toUpperCase());
        const primaryKey = flags.includes('PK');
        const foreignKey = flags.includes('FK');
        const unique = flags.includes('UK');

        const col: ERDColumn = {
          name,
          type,
          ...(primaryKey ? { primaryKey: true, nullable: false } : {}),
          ...(foreignKey ? { foreignKey: true } : {}),
          ...(unique ? { unique: true } : {}),
          ...(comment ? { comment } : {})
        };
        currentEntity.columns.push(col);

        if (unique && !primaryKey) {
          if (!currentEntity.indexes) currentEntity.indexes = [];
          currentEntity.indexes.push({ columns: [name], unique: true });
        }
      }
      continue;
    }

    // Check if relationship line: contains '--' or '..'
    let connectorIdx = rawLine.indexOf('--');
    if (connectorIdx === -1) {
      connectorIdx = rawLine.indexOf('..');
    }

    if (connectorIdx !== -1) {
      const colonIdx = rawLine.indexOf(':');
      let relPart = rawLine;
      let label = '';
      if (colonIdx !== -1) {
        relPart = rawLine.slice(0, colonIdx).trim();
        label = rawLine.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
      }

      let connIdx = relPart.indexOf('--');
      let connLen = 2;
      if (connIdx === -1) {
        connIdx = relPart.indexOf('..');
      }

      if (connIdx !== -1) {
        const leftStr = relPart.slice(0, connIdx).trim();
        const rightStr = relPart.slice(connIdx + connLen).trim();

        const cardSymbols = ['||', '|o', 'o|', '|{', '}|', 'o{', '}o'];
        let from = '';
        let leftSym = '||';
        for (const sym of cardSymbols) {
          if (leftStr.endsWith(sym)) {
            leftSym = sym;
            from = leftStr.slice(0, leftStr.length - sym.length).trim().replace(/^["']|["']$/g, '');
            break;
          }
        }
        if (!from) {
          const lTokens = leftStr.split(/\s+/).filter(Boolean);
          if (lTokens.length >= 2) {
            from = lTokens[0].replace(/^["']|["']$/g, '');
            leftSym = lTokens[1];
          } else if (lTokens.length === 1) {
            from = lTokens[0].replace(/^["']|["']$/g, '');
          }
        }

        let to = '';
        let rightSym = 'o{';
        for (const sym of cardSymbols) {
          if (rightStr.startsWith(sym)) {
            rightSym = sym;
            to = rightStr.slice(sym.length).trim().replace(/^["']|["']$/g, '');
            break;
          }
        }
        if (!to) {
          const rTokens = rightStr.split(/\s+/).filter(Boolean);
          if (rTokens.length >= 2) {
            rightSym = rTokens[0];
            to = rTokens[1].replace(/^["']|["']$/g, '');
          } else if (rTokens.length === 1) {
            to = rTokens[0].replace(/^["']|["']$/g, '');
          }
        }

        if (from && to) {
          let type: ERDRelationshipType = '1:N';
          const rightMany = rightSym.includes('{') || rightSym.includes('}');
          const leftMany = leftSym.includes('{') || leftSym.includes('}');

          if (rightMany && leftMany) {
            type = 'N:M';
          } else if (rightMany) {
            type = '1:N';
          } else if (leftMany) {
            type = 'N:1';
          } else {
            type = '1:1';
          }

          let via: string | undefined;
          if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(label)) {
            via = label;
          } else if (label.toLowerCase().includes('via:')) {
            const v = label.split('via:')[1]?.trim();
            if (v && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v)) via = v;
          }

          relationships.push({
            from,
            to,
            type,
            ...(via ? { via } : {}),
            ...(label ? { label } : {})
          });

          // Ensure both entities exist in map if not declared with braces
          if (!entityMap.has(from)) {
            const fromEnt: ERDEntity = {
              name: from,
              className: toPascalCase(singularize(from)),
              columns: [{ name: 'id', type: 'string', primaryKey: true, nullable: false }],
              indexes: []
            };
            entities.push(fromEnt);
            entityMap.set(from, fromEnt);
          }
          if (!entityMap.has(to)) {
            const toEnt: ERDEntity = {
              name: to,
              className: toPascalCase(singularize(to)),
              columns: [{ name: 'id', type: 'string', primaryKey: true, nullable: false }],
              indexes: []
            };
            entities.push(toEnt);
            entityMap.set(to, toEnt);
          }
        }
      }
      continue;
    }

    // Check if starting an entity block: e.g. "users {" or "users{"
    const openBrace = rawLine.indexOf('{');
    if (openBrace !== -1) {
      let entName = rawLine.slice(0, openBrace).trim();
      if (entName.startsWith('entity ')) {
        entName = entName.slice(7).trim();
      }
      entName = entName.replace(/^["']|["']$/g, '').trim();

      if (entName) {
        let ent = entityMap.get(entName);
        if (!ent) {
          ent = {
            name: entName,
            className: toPascalCase(singularize(entName)),
            columns: [],
            indexes: []
          };
          entities.push(ent);
          entityMap.set(entName, ent);
        }
        currentEntity = ent;

        // Check if there is an inline closing brace: e.g. "users { }"
        const closeBrace = rawLine.indexOf('}', openBrace);
        if (closeBrace !== -1) {
          currentEntity = null;
        }
        continue;
      }
    }
  }

  entities.sort((a, b) => a.name.localeCompare(b.name));
  return { entities, relationships };
}

/**
 * Generate TypeScript or JavaScript ActiveRecord model code from an ERDDocument.
 * Returns a Map of filename -> source code.
 */
export function generateModels(
  erd: ERDDocument,
  options: GenerateModelsOptions = {}
): Map<string, string> {
  const isTs = options.language !== 'javascript';
  const ext = isTs ? 'ts' : 'js';
  const includeSync = Boolean(options.includeSync);
  const includeValidation = options.includeValidation !== false;
  const result = new Map<string, string>();

  for (const entity of erd.entities) {
    const tableName = entity.name;
    const className = entity.className || toPascalCase(singularize(tableName));
    const filename = toFilename(tableName, ext);

    const hasManyMap: Record<string, string> = {};
    const hasOneMap: Record<string, string> = {};
    const belongsToMap: Record<string, string> = {};

    // Discover relationships for this entity
    for (const rel of erd.relationships) {
      if (rel.from === tableName) {
        if (rel.type === '1:N') {
          hasManyMap[rel.to] = rel.to;
        } else if (rel.type === '1:1') {
          hasOneMap[singularize(rel.to)] = rel.to;
        }
      } else if (rel.to === tableName) {
        if (rel.type === '1:N' || rel.type === '1:1') {
          belongsToMap[singularize(rel.from)] = rel.from;
        }
      }
    }

    const lines: string[] = [];

    // Header & imports
    lines.push(`// Generated by idb-activerecord ERD scaffolding`);
    lines.push(`import { ActiveRecord } from 'idb-activerecord';`);
    lines.push('');

    // TypeScript Attributes interface
    if (isTs) {
      lines.push(`export interface ${className}Attributes {`);
      for (const col of entity.columns) {
        const optional = col.primaryKey || col.nullable ? '?' : '';
        const tsType = toTsType(col.type);
        lines.push(`  ${col.name}${optional}: ${tsType};`);
      }
      lines.push('}');
      lines.push('');
    }

    // Class declaration
    const classExtends = isTs
      ? `export class ${className} extends ActiveRecord<${className}>`
      : `export class ${className} extends ActiveRecord`;

    lines.push(`${classExtends} {`);
    lines.push(`  static tableName = '${tableName}';`);

    if (includeSync || entity.enableSync) {
      lines.push(`  static enableSync = true;`);
    }

    if (entity.softDelete) {
      lines.push(`  static softDelete = true;`);
    }

    if (entity.timestamps) {
      lines.push(`  static timestamps = true;`);
    }

    if (entity.versioning) {
      lines.push(`  static versioning = true;`);
    }

    // Columns
    if (entity.columns.length > 0) {
      lines.push('');
      lines.push(`  static columns = [`);
      for (const col of entity.columns) {
        const props = [
          `name: '${col.name}'`,
          `type: '${col.type}'`
        ];
        if (col.primaryKey) props.push('primaryKey: true');
        if (col.nullable === false && !col.primaryKey) props.push('nullable: false');
        if (col.unique && !col.primaryKey) props.push('unique: true');
        lines.push(`    { ${props.join(', ')} },`);
      }
      lines.push(`  ];`);
    }

    // Indexes
    if (entity.indexes && entity.indexes.length > 0) {
      lines.push('');
      lines.push(`  static indexes = [`);
      for (const idx of entity.indexes) {
        const colsStr = idx.columns.map(c => `'${c}'`).join(', ');
        const props = [`columns: [${colsStr}]`];
        if (idx.name) props.push(`name: '${idx.name}'`);
        if (idx.unique) props.push('unique: true');
        lines.push(`    { ${props.join(', ')} },`);
      }
      lines.push(`  ];`);
    }

    // Validations
    if (includeValidation) {
      const valRules: Record<string, { presence?: boolean }> = {};
      for (const col of entity.columns) {
        if (!col.primaryKey && col.nullable === false) {
          valRules[col.name] = { presence: true };
        }
      }
      if (Object.keys(valRules).length > 0) {
        lines.push('');
        lines.push(`  static validates = {`);
        for (const [colName, rule] of Object.entries(valRules)) {
          const ruleParts = Object.entries(rule).map(([k, v]) => `${k}: ${v}`);
          lines.push(`    ${colName}: { ${ruleParts.join(', ')} },`);
        }
        lines.push(`  };`);
      }
    }

    // Relationships
    if (Object.keys(hasManyMap).length > 0) {
      lines.push('');
      lines.push(`  static hasMany = {`);
      for (const [key, tgt] of Object.entries(hasManyMap)) {
        lines.push(`    ${key}: '${tgt}',`);
      }
      lines.push(`  };`);
    }

    if (Object.keys(hasOneMap).length > 0) {
      lines.push('');
      lines.push(`  static hasOne = {`);
      for (const [key, tgt] of Object.entries(hasOneMap)) {
        lines.push(`    ${key}: '${tgt}',`);
      }
      lines.push(`  };`);
    }

    if (Object.keys(belongsToMap).length > 0) {
      lines.push('');
      lines.push(`  static belongsTo = {`);
      for (const [key, tgt] of Object.entries(belongsToMap)) {
        lines.push(`    ${key}: '${tgt}',`);
      }
      lines.push(`  };`);
    }

    // TypeScript declare instance fields
    if (isTs && entity.columns.length > 0) {
      lines.push('');
      for (const col of entity.columns) {
        const optional = col.primaryKey ? ':' : col.nullable === false ? ':' : '?:';
        lines.push(`  declare ${col.name}${optional} ${toTsType(col.type)};`);
      }
    }

    lines.push('}');
    lines.push('');

    result.set(filename, lines.join('\n'));
  }

  return result;
}

/**
 * Write generated models to disk safely.
 * Strictly validates filenames and paths against path traversal (CodeQL safe).
 */
export async function writeModelsToDisk(
  erd: ERDDocument,
  options: WriteModelsOptions
): Promise<string[]> {
  if (!options.outputDir) {
    throw new Error('outputDir is required for writeModelsToDisk');
  }

  const outputDir = path.resolve(options.outputDir);
  const models = generateModels(erd, options);
  const writtenFiles: string[] = [];

  for (const [filename, source] of models.entries()) {
    // Strictly validate filename to prevent directory traversal
    if (!/^[a-zA-Z0-9_-]+\.(ts|js)$/.test(filename)) {
      throw new Error(`Invalid model filename: "${filename}". Potential unsafe characters.`);
    }

    const resolvedPath = path.resolve(outputDir, filename);
    const expectedDirPrefix = outputDir.endsWith(path.sep) ? outputDir : outputDir + path.sep;

    if (!resolvedPath.startsWith(expectedDirPrefix) && resolvedPath !== outputDir) {
      throw new Error(
        `Path traversal detected: resolved path "${resolvedPath}" is outside target directory "${outputDir}"`
      );
    }

    await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.promises.writeFile(resolvedPath, source, 'utf-8');
    writtenFiles.push(resolvedPath);
  }

  return writtenFiles;
}
