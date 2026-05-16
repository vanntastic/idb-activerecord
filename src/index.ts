// IDB ActiveRecord - ActiveRecord-style API for IndexedDB
// Main entry point

export { Database } from './database.js';
export { ActiveRecord } from './activerecord.js';
export { QueryBuilder } from './query-builder.js';
export { Migration, TableBuilder } from './migration.js';
export type { ModelConfig, ValidationRule } from './types.js';

// Sync Adapter API
export {
  BaseAdapter,
  ConflictStrategy,
  SyncStatus
} from './sync-adapter.js';
export type {
  SyncAdapter,
  AdapterConfig,
  SyncQuery,
  PushOptions,
  SyncResult,
  TableSchema,
  ColumnDef,
  IndexDef,
  SyncMigration,
  SyncState
} from './sync-adapter.js';

// Sync Engine
export { SyncEngine } from './sync-engine.js';
export type { SyncMeta, SyncChange, SyncOptions } from './sync-engine.js';

// Built-in Adapters
export { RestAdapter } from './adapters/rest-adapter.js';
export type { RestAdapterConfig } from './adapters/rest-adapter.js';
