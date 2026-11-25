import { describe, it, expect } from 'vitest';
import { Database, ActiveRecord } from '../src/index.js';
import {
  exportSchemaToSQL,
  generateSqliteDDL,
  exportSchemaToJSON,
  toSqliteType,
  formatDefault,
  assertIdentifier,
  quoteIdentifier,
  modelToTableSchema,
  erdToTableSchemas
} from '../src/schema-export.js';
import type { ERDDocument } from '../src/erd.js';

describe('SQLite / Turso DDL Exporter (src/schema-export.ts)', () => {
  describe('identifier assertion & quoting (CodeQL-safe)', () => {
    it('accepts valid SQL identifiers', () => {
      expect(() => assertIdentifier('users')).not.toThrow();
      expect(() => assertIdentifier('user_profiles')).not.toThrow();
      expect(() => assertIdentifier('Table123')).not.toThrow();
      expect(() => assertIdentifier('_internal_meta')).not.toThrow();

      expect(quoteIdentifier('users')).toBe('"users"');
    });

    it('rejects invalid or dangerous SQL identifiers', () => {
      expect(() => assertIdentifier('users; DROP TABLE users;--')).toThrow();
      expect(() => assertIdentifier('users"name')).toThrow();
      expect(() => assertIdentifier('123users')).toThrow();
      expect(() => assertIdentifier('user-table')).toThrow();
      expect(() => assertIdentifier('users.name')).toThrow();
      expect(() => assertIdentifier('')).toThrow();
    });
  });

  describe('type mapping & formatting', () => {
    it('maps types according to TursoAdapter conventions', () => {
      expect(toSqliteType('integer')).toBe('INTEGER');
      expect(toSqliteType('int')).toBe('INTEGER');
      expect(toSqliteType('boolean')).toBe('BOOLEAN');
      expect(toSqliteType('bool')).toBe('BOOLEAN');
      expect(toSqliteType('real')).toBe('REAL');
      expect(toSqliteType('float')).toBe('REAL');
      expect(toSqliteType('number')).toBe('REAL');
      expect(toSqliteType('json')).toBe('JSON');
      expect(toSqliteType('object')).toBe('JSON');
      expect(toSqliteType('array')).toBe('JSON');
      expect(toSqliteType('datetime')).toBe('TEXT');
      expect(toSqliteType('string')).toBe('TEXT');
      expect(toSqliteType('text')).toBe('TEXT');
      expect(toSqliteType(undefined)).toBe('TEXT');
    });

    it('formats default values correctly', () => {
      expect(formatDefault(null)).toBe('NULL');
      expect(formatDefault(42)).toBe('42');
      expect(formatDefault(true)).toBe('1');
      expect(formatDefault(false)).toBe('0');
      expect(formatDefault('active')).toBe("'active'");
      expect(formatDefault("O'Connor")).toBe("'O''Connor'");
    });
  });

  describe('exportSchemaToSQL from ActiveRecord model classes', () => {
    class TaskModel extends ActiveRecord {
      static tableName = 'tasks';
      static columns = {
        title: { type: 'string', nullable: false },
        completed: { type: 'boolean', default: false },
        priority: { type: 'integer', default: 0 },
        metadata: { type: 'json' }
      };
      static indexes = [
        { name: 'idx_tasks_completed', columns: ['completed'] },
        { name: 'idx_tasks_prio', columns: ['priority'], unique: true }
      ];
    }

    class UserModel extends ActiveRecord {
      static tableName = 'users';
      static enableSync = true;
      static columns = {
        name: { type: 'string', nullable: false },
        email: { type: 'string' }
      };
      static indexes = [
        { columns: ['email'], unique: true }
      ];
    }

    it('generates deterministic CREATE TABLE IF NOT EXISTS and CREATE INDEX statements', () => {
      const sql = exportSchemaToSQL([TaskModel]);
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS "tasks" (');
      expect(sql).toContain('"id" TEXT PRIMARY KEY NOT NULL');
      expect(sql).toContain('"title" TEXT NOT NULL');
      expect(sql).toContain('"completed" BOOLEAN DEFAULT 0');
      expect(sql).toContain('"priority" INTEGER DEFAULT 0');
      expect(sql).toContain('"metadata" JSON');

      // Indexes
      expect(sql).toContain('CREATE INDEX IF NOT EXISTS "idx_tasks_completed" ON "tasks" ("completed");');
      expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "idx_tasks_prio" ON "tasks" ("priority");');
    });

    it('generates sync metadata columns when model has enableSync or syncColumns option is passed', () => {
      const sql = exportSchemaToSQL([UserModel]);
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS "users" (');
      expect(sql).toContain('"updatedAt" TEXT NOT NULL DEFAULT \'\'');
      expect(sql).toContain('"version" INTEGER NOT NULL DEFAULT 1');
      expect(sql).toContain('"deleted_at" TEXT');
      expect(sql).toContain('"owner_id" TEXT DEFAULT \'demo\'');

      // With explicit syncColumns option on TaskModel
      const taskSyncSql = exportSchemaToSQL([TaskModel], { syncColumns: true });
      expect(taskSyncSql).toContain('"updatedAt" TEXT NOT NULL DEFAULT \'\'');
      expect(taskSyncSql).toContain('"version" INTEGER NOT NULL DEFAULT 1');
      expect(taskSyncSql).toContain('"deleted_at" TEXT');
      expect(taskSyncSql).toContain('"owner_id" TEXT DEFAULT \'demo\'');
    });

    it('provides generateSqliteDDL alias identical to exportSchemaToSQL', () => {
      expect(generateSqliteDDL([TaskModel])).toBe(exportSchemaToSQL([TaskModel]));
    });
  });

  describe('exportSchemaToSQL from Database instance', () => {
    it('exports all registered models in alphabetical order', () => {
      class Author extends ActiveRecord {
        static tableName = 'authors';
        static columns = { name: { type: 'string' } };
      }
      class Book extends ActiveRecord {
        static tableName = 'books';
        static columns = { title: { type: 'string' }, authorId: { type: 'string' } };
      }

      const db = new Database('library');
      db.registerModel(Book);
      db.registerModel(Author);

      const sql = exportSchemaToSQL(db);
      const authorsIdx = sql.indexOf('"authors"');
      const booksIdx = sql.indexOf('"books"');

      // Deterministic alphabetical sorting: authors before books
      expect(authorsIdx).toBeGreaterThan(-1);
      expect(booksIdx).toBeGreaterThan(-1);
      expect(authorsIdx).toBeLessThan(booksIdx);
    });
  });

  describe('exportSchemaToSQL from ERDDocument', () => {
    it('exports DDL matching ERD entities and indexes', () => {
      const erdDoc: ERDDocument = {
        entities: [
          {
            name: 'projects',
            columns: [
              { name: 'id', type: 'string', primaryKey: true },
              { name: 'name', type: 'string', nullable: false },
              { name: 'code', type: 'string', unique: true }
            ],
            indexes: [
              { name: 'idx_projects_code', columns: ['code'], unique: true }
            ]
          }
        ],
        relationships: []
      };

      const sql = exportSchemaToSQL(erdDoc);
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS "projects" (');
      expect(sql).toContain('"id" TEXT PRIMARY KEY NOT NULL');
      expect(sql).toContain('"name" TEXT NOT NULL');
      expect(sql).toContain('"code" TEXT');
      expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "idx_projects_code" ON "projects" ("code");');
    });
  });

  describe('exportSchemaToJSON', () => {
    it('emits structured JSON schema for tables and columns', () => {
      class Product extends ActiveRecord {
        static tableName = 'products';
        static columns = {
          title: { type: 'string' },
          price: { type: 'real' }
        };
      }

      const jsonStr = exportSchemaToJSON([Product]);
      const parsed = JSON.parse(jsonStr);
      expect(parsed.tables).toBeDefined();
      expect(parsed.tables).toHaveLength(1);
      expect(parsed.tables[0].name).toBe('products');
      expect(parsed.tables[0].columns.some((c: any) => c.name === 'price' && c.type === 'real')).toBe(true);
    });
  });
});
