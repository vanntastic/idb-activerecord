// IDB ActiveRecord - ActiveRecord-style API for IndexedDB
// Main entry point

export { Database } from './database.js';
export type {
  AutoSyncOptions,
  DatabaseOptions,
  DatabaseSyncOptions,
  SyncShorthandOptions
} from './database.js';

export { ActiveRecord, singularize, createLiveQuery } from './activerecord.js';
export type {
  ActiveRecordDefaults,
  ModelAttributes,
  ModelConstructor,
  MutationEvent,
  LiveQueryOptions,
  LiveQueryStore
} from './activerecord.js';

export { QueryBuilder } from './query-builder.js';
export { Migration, TableBuilder } from './migration.js';
export type { ModelConfig, ValidationRule } from './types.js';

// Pluggable Storage Adapters
export { IndexedDBStorageAdapter } from './storage-adapter.js';
export type { StorageAdapter, StorageQuery, StoreOptions } from './storage-adapter.js';

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
export { TursoAdapter, TursoStorageAdapter } from './adapters/turso-adapter.js';
export type {
  TursoAdapterConfig,
  TursoClient,
  TursoStatement,
  TursoStorageAdapterConfig
} from './adapters/turso-adapter.js';
export { SQLiteAdapter } from './adapters/sqlite-adapter.js';
export type { SQLiteAdapterConfig, SQLiteClient } from './adapters/sqlite-adapter.js';
