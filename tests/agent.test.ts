import { describe, it, expect } from 'vitest';
import {
  AgentContext,
  whyIsntThisWorking,
  generateCodeFor,
  explainDatabase,
  explainModel,
  toAgentError
} from '../src/agent.js';
import { Database, ActiveRecord } from '../src/index.js';

describe('Bundled Agent Helpers (idb-activerecord/agent)', () => {
  describe('AgentContext', () => {
    it('provides structured library metadata', () => {
      expect(AgentContext.version).toBe('2.1.0');
      expect(AgentContext.name).toBe('idb-activerecord');
      expect(AgentContext.capabilities).toContain('zero-config-database-default');
      expect(AgentContext.capabilities).toContain('direct-ssr-mode-via-turso-storage');
      expect(AgentContext.subpathExports['.']).toBeDefined();
      expect(AgentContext.subpathExports['./agent']).toBeDefined();
      expect(AgentContext.subpathExports['./react']).toBeDefined();
      expect(AgentContext.quickStart).toContain('ActiveRecord');
      expect(AgentContext.commonTasks.zeroConfigPoc).toBeDefined();
      expect(AgentContext.commonTasks.tursoStorageSsr).toBeDefined();
      expect(AgentContext.commonTasks.modelTemplate).toBeDefined();
    });
  });

  describe('whyIsntThisWorking runtime diagnostics', () => {
    it('diagnoses SSR missing IndexedDB', () => {
      const result = whyIsntThisWorking({
        error: new Error('IndexedDB is not available in this environment. Database operations require a browser environment or an IndexedDB polyfill.')
      });
      expect(result.problem).toMatch(/server-side rendering|IndexedDB/i);
      expect(result.solution).toMatch(/TursoStorageAdapter/i);
      expect(result.codeFix).toContain('TursoStorageAdapter');
    });

    it('diagnoses Database not connected', () => {
      const result = whyIsntThisWorking({
        error: new Error('Database not connected. Call connect() first.')
      });
      expect(result.problem).toMatch(/not connected/i);
      expect(result.solution).toMatch(/connect/i);
      expect(result.codeFix).toContain('connect');
    });

    it('diagnoses 401 Unauthorized / getSessionUser', () => {
      const result = whyIsntThisWorking({
        error: 'Sync error: 401 Unauthorized',
        code: 'UNAUTHORIZED'
      });
      expect(result.problem).toMatch(/401/i);
      expect(result.solution).toMatch(/getAuthHeaders|getSessionUser/i);
      expect(result.codeFix).toContain('Authorization');
    });

    it('diagnoses table not found / autoProvision', () => {
      const result = whyIsntThisWorking({
        error: new Error('SQLite error: no such table: tasks')
      });
      expect(result.problem).toMatch(/table does not exist/i);
      expect(result.solution).toMatch(/autoProvision/i);
    });

    it('diagnoses missing tableName', () => {
      const result = whyIsntThisWorking({
        error: new Error('Cannot push records without tableName')
      });
      expect(result.problem).toMatch(/tableName/i);
      expect(result.solution).toMatch(/static tableName/i);
      expect(result.codeFix).toContain('tableName');
    });

    it('diagnoses Foreign Key / relationship table mismatch', () => {
      const result = whyIsntThisWorking({
        error: new Error('Relationship tasks references unknown table "users".')
      });
      expect(result.problem).toMatch(/relationship/i);
      expect(result.solution).toMatch(/registerModel/i);
    });

    it('diagnoses version conflicts', () => {
      const result = whyIsntThisWorking({
        error: 'version_conflict: server=5 client=2'
      });
      expect(result.problem).toMatch(/concurrency|version/i);
      expect(result.solution).toMatch(/conflict/i);
    });

    it('diagnoses JSON serialization issues', () => {
      const result = whyIsntThisWorking({
        error: 'JSON parse error at position 0'
      });
      expect(result.problem).toMatch(/json/i);
      expect(result.solution).toMatch(/type: 'json'/i);
    });

    it('returns a helpful fallback for generic errors', () => {
      const result = whyIsntThisWorking({
        error: new Error('Unknown connection timeout')
      });
      expect(result.problem).toContain('Unknown connection timeout');
      expect(result.solution).toBeDefined();
    });
  });

  describe('generateCodeFor snippet generator', () => {
    it('generates a complete model class', () => {
      const code = generateCodeFor('model', { name: 'Todo', table: 'todos' });
      expect(code).toContain('class Todo extends ActiveRecord<Todo>');
      expect(code).toContain("static tableName = 'todos'");
      expect(code).toContain('static columns = {');
      expect(code).toContain('static indexes = [');
    });

    it('generates an Astro sync route', () => {
      const code = generateCodeFor('sync-route', { framework: 'astro', basePath: '/api/sync' });
      expect(code).toContain('import { createSyncHandler } from \'idb-activerecord/server\'');
      expect(code).toContain('export const ALL: APIRoute');
      expect(code).toContain("basePath: '/api/sync'");
    });

    it('generates a Next.js App Router sync route', () => {
      const code = generateCodeFor('sync-route', { framework: 'next', basePath: '/api/sync' });
      expect(code).toContain('import { createSyncHandler } from \'idb-activerecord/server\'');
      expect(code).toContain('export { handler as GET, handler as POST, handler as DELETE }');
    });

    it('generates a Hono sync route', () => {
      const code = generateCodeFor('sync-route', { framework: 'hono', basePath: '/api/sync' });
      expect(code).toContain('import { Hono } from \'hono\'');
      expect(code).toContain('app.all(\'/api/sync/*\'');
    });

    it('generates client sync code with backfill', () => {
      const code = generateCodeFor('client-sync', { name: 'Todo', basePath: '/api/sync' });
      expect(code).toContain('new Database(');
      expect(code).toContain('db.backfillSync()');
    });

    it('generates a React live query component', () => {
      const code = generateCodeFor('live-query', { name: 'Todo' });
      expect(code).toContain('useLiveQuery');
      expect(code).toContain('Todo.where');
    });
  });

  describe('Introspection (explainDatabase and explainModel)', () => {
    it('formats readable summary of Database', () => {
      const db = new Database('test_explain');
      class Project extends ActiveRecord {
        static tableName = 'projects';
        static enableSync = true;
      }
      db.registerModel(Project);

      const tree = explainDatabase(db);
      expect(tree).toContain('Database: "test_explain"');
      expect(tree).toContain('Registered Models (1):');
      expect(tree).toContain('projects');
      expect(db.explain()).toBe(tree);
    });

    it('formats readable summary of ActiveRecord model', () => {
      class Task extends ActiveRecord<Task> {
        static tableName = 'tasks';
        static enableSync = true;
        static columns = {
          title: { type: 'string', nullable: false },
          priority: { type: 'integer' }
        };
        static indexes = [
          { name: 'idx_tasks_priority', keyPath: 'priority' }
        ];
      }

      const tree = explainModel(Task);
      expect(tree).toContain('ActiveRecord Model: Task');
      expect(tree).toContain('Table: tasks');
      expect(tree).toContain('title: string');
      expect(tree).toContain('idx_tasks_priority');
      expect(Task.explain()).toBe(tree);
    });
  });

  describe('toAgentError structured error helper', () => {
    it('converts Error objects into structured AgentError', () => {
      const agentErr = toAgentError(new Error('IndexedDB is not available'));
      expect(agentErr.errorType).toBe('Error');
      expect(agentErr.message).toContain('IndexedDB is not available');
      expect(agentErr.suggestions.length).toBeGreaterThan(0);
      expect(agentErr.docs).toContain('agentic-dx.html');
    });
  });
});
