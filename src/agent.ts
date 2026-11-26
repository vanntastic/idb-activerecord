// Bundled Agent Helpers for idb-activerecord
// Exported via subpath "idb-activerecord/agent"
// Zero core bundle overhead (never imported from src/index.ts).

import type { Database } from './database.js';
import type { ActiveRecord } from './activerecord.js';

export interface AgentContextType {
  version: string;
  name: string;
  description: string;
  quickStart: string;
  capabilities: string[];
  subpathExports: Record<string, string>;
  commonTasks: {
    zeroConfigPoc: string;
    relationships: string;
    liveQuery: string;
    syncRouteAstro: string;
    syncRouteNext: string;
    syncRouteHono: string;
    backfillSync: string;
    tursoStorageSsr: string;
    modelTemplate: string;
    exportSchema: string;
    erdTooling: string;
    erd?: string;
    'export-schema'?: string;
    'idb-activerecord/erd'?: string;
  };
}

export const AgentContext: AgentContextType = {
  version: '2.1.0',
  name: 'idb-activerecord',
  description:
    'ActiveRecord-style ORM for IndexedDB with automatic schema migrations, reactive queries, and turnkey multi-tenant Turso cloud sync.',
  capabilities: [
    'zero-config-database-default',
    'active-record-orm-and-relationships',
    'chainable-query-builder',
    'reactive-live-queries',
    'turso-and-sqlite-cloud-sync',
    'multi-tenant-auth-verification',
    'offline-first-change-tracking',
    'schema-auto-provisioning',
    'direct-ssr-mode-via-turso-storage',
    'agent-runtime-diagnostics',
    'cli-ddl-exporter',
    'bidirectional-erd-tooling'
  ],
  subpathExports: {
    '.': 'Core ActiveRecord, Database, QueryBuilder, Migration, and IDB/Turso sync adapters',
    './server': 'Web-standard createSyncHandler for Astro, Next.js, Hono, and Node servers',
    './agent': 'Agent metadata, runtime diagnostics (whyIsntThisWorking), and deterministic code generator',
    './react': 'useLiveQuery hook for reactive UI rendering with SSR safety',
    './turso-adapter': 'TursoAdapter for cloud sync and TursoStorageAdapter for direct SSR querying',
    './sqlite-adapter': 'SQLiteAdapter for Node.js node:sqlite DatabaseSync',
    './sync-server': 'Standalone HTTP sync server for development and testing',
    './erd': 'Bidirectional ERD generation (generateERD, exportToMermaid, exportToPlantUML) and model scaffolding (parseMermaid, generateModels)'
  },
  quickStart: `import { ActiveRecord } from 'idb-activerecord';

class Task extends ActiveRecord {
  static tableName = 'tasks';
}

// Zero-config: lazy auto-connects to Database.default on first query
const task = await Task.create({ title: 'Build agent feature' });
const allTasks = await Task.where('title', 'like', '%agent%').all();`,
  commonTasks: {
    zeroConfigPoc: `import { ActiveRecord } from 'idb-activerecord';

class Task extends ActiveRecord {
  static tableName = 'tasks';
}

await Task.create({ title: 'Day 0 task' });
const pending = await Task.all();`,

    relationships: `import { Database, ActiveRecord } from 'idb-activerecord';

class User extends ActiveRecord {
  static tableName = 'users';
  static hasMany = { tasks: 'tasks' };
}

class Task extends ActiveRecord {
  static tableName = 'tasks';
  static belongsTo = { user: 'users' };
}

const db = new Database('app');
db.registerModel(User);
db.registerModel(Task);
await db.connect();

const user = await User.create({ name: 'Alice' });
const task = await Task.create({ title: 'Write tests', userId: user.id });
const userTasks = await user.tasks();`,

    liveQuery: `import { useLiveQuery } from 'idb-activerecord/react';
import { Task } from './models/task';

export function TaskList() {
  const tasks = useLiveQuery(() => Task.where('done', false).all(), []);
  if (!tasks) return <div>Loading...</div>;
  return (
    <ul>
      {tasks.map(t => <li key={t.id}>{t.title}</li>)}
    </ul>
  );
}`,

    syncRouteAstro: `// src/pages/api/sync/[...table].ts (Astro)
import type { APIRoute } from 'astro';
import { createClient } from '@libsql/client';
import { createSyncHandler } from 'idb-activerecord/server';

const client = createClient({
  url: import.meta.env.TURSO_DATABASE_URL,
  authToken: import.meta.env.TURSO_AUTH_TOKEN
});

export const ALL: APIRoute = createSyncHandler({
  client,
  basePath: '/api/sync',
  autoProvision: true,
  getSessionUser: async (req) => {
    // Return verified user ID or null for 401 Unauthorized
    const authHeader = req.headers.get('Authorization');
    return authHeader ? 'verified-user-id' : null;
  }
});`,

    syncRouteNext: `// src/app/api/sync/[...table]/route.ts (Next.js App Router)
import { createClient } from '@libsql/client';
import { createSyncHandler } from 'idb-activerecord/server';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!
});

const handler = createSyncHandler({
  client,
  basePath: '/api/sync',
  autoProvision: true,
  getSessionUser: async (req) => {
    // Extract session from Clerk / NextAuth / headers
    const auth = req.headers.get('authorization');
    return auth?.replace('Bearer ', '') || null;
  }
});

export { handler as GET, handler as POST, handler as DELETE };`,

    syncRouteHono: `// server.ts (Hono)
import { Hono } from 'hono';
import { createClient } from '@libsql/client';
import { createSyncHandler } from 'idb-activerecord/server';

const app = new Hono();
const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!
});

const syncHandler = createSyncHandler({
  client,
  basePath: '/api/sync',
  autoProvision: true,
  getSessionUser: async (req) => req.headers.get('x-user-id')
});

app.all('/api/sync/*', (c) => syncHandler(c.req.raw));
export default app;`,

    backfillSync: `// Staging pre-existing offline records for synchronization
const db = Database.getDefault();
await db.connect();

// Backfills all registered models with enableSync = true
const result = await db.backfillSync();
console.log('Queued records for initial sync:', result.queuedCount);`,

    tursoStorageSsr: `// Direct server querying without IndexedDB (Astro / Next.js SSR / Node.js)
import { createClient } from '@libsql/client';
import { Database, ActiveRecord } from 'idb-activerecord';
import { TursoStorageAdapter } from 'idb-activerecord/turso-adapter';

class Task extends ActiveRecord {
  static tableName = 'tasks';
}

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!
});

const db = new Database('app', {
  storage: new TursoStorageAdapter({ client })
});
db.registerModel(Task);
await db.connect();

// Queries Turso directly via standard ActiveRecord methods
const tasks = await Task.where('status', 'active').all();`,

    modelTemplate: `import { ActiveRecord } from 'idb-activerecord';

export class Task extends ActiveRecord<Task> {
  static tableName = 'tasks';
  static enableSync = true;
  static softDelete = true;
  static timestamps = true;

  static columns = {
    title: { type: 'string', nullable: false },
    completed: { type: 'boolean', default: false },
    priority: { type: 'integer', default: 0 },
    metadata: { type: 'json', nullable: true }
  };

  static indexes = [
    { name: 'idx_tasks_completed', keyPath: 'completed' },
    { name: 'idx_tasks_priority', keyPath: 'priority' }
  ];

  static validates = {
    title: { presence: true, length: { minimum: 1, maximum: 200 } }
  };
}`,

    exportSchema: `// CLI SQLite DDL export:
// npx idb-activerecord export-schema --input ./src/db.js --sync-columns --output schema.sql
//
// Programmatic SQLite DDL export:
import { exportSchemaToSQL } from 'idb-activerecord';
import { db } from './db.js';

const sql = exportSchemaToSQL(db, { syncColumns: true });
console.log(sql);`,

    erdTooling: `// CLI ERD Scaffolding:
// npx idb-activerecord erd generate-models --input schema.mmd --output ./src/models --sync
//
// Programmatic Bidirectional ERD:
import { generateERD, exportToMermaid, parseMermaid, generateModels } from 'idb-activerecord/erd';
import { db } from './db.js';

// Model -> Mermaid ERD
const erd = generateERD(db);
const mermaid = exportToMermaid(erd);

// Mermaid ERD -> Model Code Map
const parsedErd = parseMermaid(mermaid);
const modelFiles = generateModels(parsedErd, { language: 'typescript', includeSync: true });`,

    erd: `import { generateERD, exportToMermaid } from 'idb-activerecord/erd';
import { db } from './db.js';

const erd = generateERD(db);
const mermaidDiagram = exportToMermaid(erd);`,

    'export-schema': `npx idb-activerecord export-schema --input ./src/db.js --sync-columns --output schema.sql`,
    'idb-activerecord/erd': `import { generateERD, exportToMermaid, parseMermaid, generateModels } from 'idb-activerecord/erd';`
  }
};

export interface DiagnosisResult {
  problem: string;
  solution: string;
  codeFix?: string;
  docsUrl?: string;
}

export interface DiagnosisInput {
  error: unknown;
  code?: string;
  context?: Record<string, unknown>;
}

/**
 * Diagnostic runtime assistant for common failures in idb-activerecord.
 */
export function whyIsntThisWorking(input: DiagnosisInput): DiagnosisResult {
  const rawMsg =
    input.error instanceof Error
      ? input.error.message
      : typeof input.error === 'string'
      ? input.error
      : JSON.stringify(input.error ?? '');

  const msg = `${rawMsg} ${input.code ?? ''}`.toLowerCase();

  // 1. SSR missing indexedDB
  if (
    msg.includes('indexeddb is not available') ||
    msg.includes('indexeddb is undefined') ||
    msg.includes('window is not defined') ||
    msg.includes('indexeddb polyfill')
  ) {
    return {
      problem:
        'IndexedDB was accessed in a server-side rendering (SSR) or Node.js environment where globalThis.indexedDB is unavailable.',
      solution:
        'For server routes or SSR, use TursoStorageAdapter with new Database(name, { storage: new TursoStorageAdapter({ client }) }), or ensure client queries only run in browser lifecycles (e.g. inside useEffect or useLiveQuery).',
      codeFix: `import { Database } from 'idb-activerecord';
import { TursoStorageAdapter } from 'idb-activerecord/turso-adapter';
import { createClient } from '@libsql/client';

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
const db = new Database('app', { storage: new TursoStorageAdapter({ client }) });`,
      docsUrl: 'https://vanntastic.github.io/idb-activerecord/guide/agentic-dx.html#ssr-turso-storage'
    };
  }

  // 2. Database not connected
  if (
    msg.includes('database not connected') ||
    msg.includes('call connect() first')
  ) {
    return {
      problem:
        'An ActiveRecord method was called before the database was connected (Database not connected).',
      solution:
        'Call await db.connect() before performing operations, or rely on Database.default lazy auto-connect.',
      codeFix: `await db.connect();`,
      docsUrl: 'https://vanntastic.github.io/idb-activerecord/guide/getting-started.html'
    };
  }

  // 3. 401 Unauthorized / getSessionUser
  if (
    msg.includes('401') ||
    msg.includes('unauthorized') ||
    msg.includes('getsessionuser') ||
    msg.includes('missing auth')
  ) {
    return {
      problem:
        'The sync server rejected the request with 401 Unauthorized because authentication credentials were not provided or failed verification.',
      solution:
        'Pass getAuthHeaders on your sync adapter or db.sync() to include Authorization tokens, and ensure getSessionUser in createSyncHandler validates the session token.',
      codeFix: `await db.sync('tasks', {
  url: '/api/sync',
  getAuthHeaders: async () => ({ Authorization: \`Bearer \${await getToken()}\` })
});`,
      docsUrl: 'https://vanntastic.github.io/idb-activerecord/guide/agentic-dx.html#auth-multitenancy'
    };
  }

  // 4. Table not found / autoProvision
  if (
    msg.includes('no such table') ||
    msg.includes('table not found') ||
    msg.includes('autoprovision')
  ) {
    return {
      problem:
        'The target table does not exist in the remote database.',
      solution:
        'Enable autoProvision: true in createSyncHandler, or declare static columns on your model so ensureTable can provision it.',
      codeFix: `// Server-side:
createSyncHandler({ client, basePath: '/api/sync', autoProvision: true });

// Model-side:
class Task extends ActiveRecord {
  static tableName = 'tasks';
  static columns = { title: { type: 'string' } };
}`,
      docsUrl: 'https://vanntastic.github.io/idb-activerecord/guide/agentic-dx.html#schema-provisioning'
    };
  }

  // 5. Missing tableName
  if (
    msg.includes('cannot push records without tablename') ||
    msg.includes('missing tablename') ||
    msg.includes('tablename is required')
  ) {
    return {
      problem:
        'The ActiveRecord model subclass does not specify a static tableName.',
      solution:
        'Declare static tableName = "your_table_name" on the model class.',
      codeFix: `class Task extends ActiveRecord {
  static tableName = 'tasks';
}`,
      docsUrl: 'https://vanntastic.github.io/idb-activerecord/guide/models.html'
    };
  }

  // 6. Foreign Key / Relationship mismatch
  if (
    msg.includes('references unknown table') ||
    msg.includes('foreign key') ||
    msg.includes('relationship')
  ) {
    return {
      problem:
        'A model relationship references a table that has not been registered in Database.models.',
      solution:
        'Register all related models with db.registerModel(Model) before establishing connections or querying relationships.',
      codeFix: `db.registerModel(User);
db.registerModel(Task);
await db.connect();`,
      docsUrl: 'https://vanntastic.github.io/idb-activerecord/guide/models.html#relationships'
    };
  }

  // 7. Version conflicts
  if (
    msg.includes('version_conflict') ||
    msg.includes('conflict') ||
    msg.includes('concurrency')
  ) {
    return {
      problem:
        'Optimistic concurrency check failed because the remote record has a higher version number than the local update.',
      solution:
        'Pull latest changes from remote to update local versions, or configure a conflict resolution strategy (e.g. ConflictStrategy.LAST_WRITE_WINS or "client-wins").',
      codeFix: `await db.sync('tasks', adapter, { strategy: ConflictStrategy.LAST_WRITE_WINS });`,
      docsUrl: 'https://vanntastic.github.io/idb-activerecord/sync/conflict-resolution.html'
    };
  }

  // 8. JSON serialization
  if (
    msg.includes('json') ||
    msg.includes('unexpected token') ||
    msg.includes('serialization')
  ) {
    return {
      problem:
        'An object or array column failed to serialize or deserialize correctly as JSON.',
      solution:
        "Declare the column with type: 'json' in your model static columns so Turso and SQLite adapters know to parse and stringify it automatically.",
      codeFix: `static columns = {
  metadata: { type: 'json' },
  tags: { type: 'json' }
};`,
      docsUrl: 'https://vanntastic.github.io/idb-activerecord/guide/agentic-dx.html#serialization'
    };
  }

  // Fallback diagnosis
  return {
    problem: `Runtime error encountered: ${rawMsg}`,
    solution:
      'Check database connection status, model table declarations, and adapter configurations.',
    docsUrl: 'https://vanntastic.github.io/idb-activerecord/'
  };
}

export interface CodeGeneratorOptions {
  name?: string;
  table?: string;
  framework?: 'astro' | 'next' | 'hono';
  basePath?: string;
  authProvider?: 'clerk' | 'custom' | 'none';
  enableSync?: boolean;
}

/**
 * Deterministic code generator for boilerplate idb-activerecord integrations.
 */
export function generateCodeFor(
  task: 'model' | 'sync-route' | 'client-sync' | 'live-query',
  options: CodeGeneratorOptions = {}
): string {
  const modelName = options.name || 'Task';
  const tableName = options.table || `${modelName.toLowerCase()}s`;
  const framework = options.framework || 'next';
  const basePath = options.basePath || '/api/sync';

  switch (task) {
    case 'model':
      return `import { ActiveRecord } from 'idb-activerecord';

export class ${modelName} extends ActiveRecord<${modelName}> {
  static tableName = '${tableName}';
  static enableSync = ${options.enableSync ?? true};
  static softDelete = true;
  static timestamps = true;

  static columns = {
    title: { type: 'string', nullable: false },
    status: { type: 'string', default: 'pending' },
    metadata: { type: 'json', nullable: true }
  };

  static indexes = [
    { name: 'idx_${tableName}_status', keyPath: 'status' }
  ];

  static validates = {
    title: { presence: true }
  };
}`;

    case 'sync-route': {
      if (framework === 'astro') {
        return `import type { APIRoute } from 'astro';
import { createClient } from '@libsql/client';
import { createSyncHandler } from 'idb-activerecord/server';

const client = createClient({
  url: import.meta.env.TURSO_DATABASE_URL,
  authToken: import.meta.env.TURSO_AUTH_TOKEN
});

export const ALL: APIRoute = createSyncHandler({
  client,
  basePath: '${basePath}',
  autoProvision: true,
  getSessionUser: async (req) => {
    const auth = req.headers.get('Authorization');
    return auth ? 'user_session_id' : null;
  }
});`;
      }

      if (framework === 'hono') {
        return `import { Hono } from 'hono';
import { createClient } from '@libsql/client';
import { createSyncHandler } from 'idb-activerecord/server';

const app = new Hono();
const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!
});

const handler = createSyncHandler({
  client,
  basePath: '${basePath}',
  autoProvision: true,
  getSessionUser: async (req) => req.headers.get('x-user-id')
});

app.all('${basePath}/*', (c) => handler(c.req.raw));
export default app;`;
      }

      // Next.js App Router default
      return `import { createClient } from '@libsql/client';
import { createSyncHandler } from 'idb-activerecord/server';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!
});

const handler = createSyncHandler({
  client,
  basePath: '${basePath}',
  autoProvision: true,
  getSessionUser: async (req) => {
    const auth = req.headers.get('Authorization');
    return auth?.replace('Bearer ', '') || null;
  }
});

export { handler as GET, handler as POST, handler as DELETE };`;
    }

    case 'client-sync':
      return `import { Database } from 'idb-activerecord';
import { ${modelName} } from './models/${modelName.toLowerCase()}';

const db = new Database('app_db', {
  sync: {
    url: '${basePath}',
    auto: true,
    interval: 30000,
    offlineQueue: true,
    getAuthHeaders: async () => ({
      Authorization: \`Bearer \${localStorage.getItem('token')}\`
    })
  }
});

db.registerModel(${modelName});
await db.connect();
await db.backfillSync();`;

    case 'live-query':
      return `import React from 'react';
import { useLiveQuery } from 'idb-activerecord/react';
import { ${modelName} } from './models/${modelName.toLowerCase()}';

export function ${modelName}View() {
  const items = useLiveQuery(() => ${modelName}.where('status', 'pending').all(), []);

  if (!items) return <p>Loading...</p>;

  return (
    <div>
      <h3>${modelName} List ({items.length})</h3>
      <ul>
        {items.map((item: any) => (
          <li key={item.id}>{item.title || item.name}</li>
        ))}
      </ul>
    </div>
  );
}`;
  }
}

/**
 * Format a database summary tree.
 */
export function explainDatabase(db: Database): string {
  return typeof db.explain === 'function' ? db.explain() : `Database: ${db.getName()}`;
}

/**
 * Format an ActiveRecord model summary tree.
 */
export function explainModel(model: typeof ActiveRecord): string {
  return typeof model.explain === 'function' ? model.explain() : `Model: ${model.name}`;
}

export interface AgentError {
  errorType: string;
  message: string;
  suggestions: string[];
  docs?: string;
}

/**
 * Convert any library error into a structured agent-friendly error object.
 */
export function toAgentError(err: unknown): AgentError {
  const diagnosis = whyIsntThisWorking({ error: err });
  const rawMsg = err instanceof Error ? err.message : String(err);
  const errorType = err instanceof Error ? err.constructor.name : 'DatabaseError';

  return {
    errorType,
    message: rawMsg,
    suggestions: [diagnosis.problem, diagnosis.solution, diagnosis.codeFix ?? ''].filter(Boolean),
    docs: diagnosis.docsUrl
  };
}
