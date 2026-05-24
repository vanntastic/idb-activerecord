// Sync Adapter API for 3rd Party Database Providers
// Phase 1: Core Adapter Interface

import { ActiveRecord } from './activerecord.js';

/**
 * Configuration options for connecting to a sync adapter
 */
export interface AdapterConfig {
  /**
   * Optional connection URL. Required by HTTP mode adapters like `TursoAdapter`,
   * not used by client-injected adapters like `TursoAdapter` (which carry the
   * connection in a pre-built client instance) or `SQLiteAdapter`.
   */
  url?: string;
  authToken?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  timeout?: number;
}

/**
 * Query options for pulling data from remote
 */
export interface SyncQuery {
  table: string;
  since?: Date;
  where?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
}

/**
 * Options for pushing data to remote
 */
export interface PushOptions {
  table?: string;
  batchSize?: number;
  onConflict?: ConflictStrategy;
  skipConflicts?: boolean;
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
  errors: Array<{ record: unknown; error: string }>;
  timestamp: Date;
}

/**
 * Schema definition for a table
 */
export interface TableSchema {
  name: string;
  columns: ColumnDef[];
  indexes: IndexDef[];
}

export interface ColumnDef {
  name: string;
  type: string;
  nullable: boolean;
  default?: unknown;
  primaryKey?: boolean;
  autoIncrement?: boolean;
}

export interface IndexDef {
  name: string;
  columns: string[];
  unique: boolean;
}

/**
 * Migration definition for schema changes
 */
export interface SyncMigration {
  version: number;
  name: string;
  up: (db: unknown) => Promise<void>;
  down: (db: unknown) => Promise<void>;
}

/**
 * Conflict resolution strategies
 */
export enum ConflictStrategy {
  LOCAL_WINS = 'local',
  REMOTE_WINS = 'remote',
  LAST_WRITE_WINS = 'timestamp',
  CUSTOM = 'custom'
}

/**
 * Sync status for tracking operations
 */
export enum SyncStatus {
  IDLE = 'idle',
  SYNCING = 'syncing',
  ERROR = 'error',
  OFFLINE = 'offline'
}

/**
 * Sync state tracked per model
 */
export interface SyncState {
  lastSyncAt: Date | null;
  lastPushAt: Date | null;
  lastPullAt: Date | null;
  status: SyncStatus;
  pendingOperations: number;
}

/**
 * Core Sync Adapter Interface
 * All 3rd party adapters must implement this interface
 */
export interface SyncAdapter {
  /** Adapter configuration */
  config: AdapterConfig;

  /** Current sync state */
  state: SyncState;

  /**
   * Establish connection to the remote database
   */
  connect(config: AdapterConfig): Promise<void>;

  /**
   * Close connection to the remote database
   */
  disconnect(): Promise<void>;

  /**
   * Check if adapter is connected
   */
  isConnected(): boolean;

  /**
   * Pull records from remote database
   */
  pull<T extends ActiveRecord>(query: SyncQuery): Promise<T[]>;

  /**
   * Push records to remote database
   */
  push<T extends ActiveRecord>(
    records: T[],
    options?: PushOptions
  ): Promise<SyncResult>;

  /**
   * Fetch remote schema for a table
   */
  getRemoteSchema(table: string): Promise<TableSchema>;

  /**
   * Apply a migration to the remote database
   */
  applyMigration(migration: SyncMigration): Promise<void>;

  /**
   * Ensure a table exists on the remote, creating it if necessary.
   * columns is an optional hint; the server may infer schema from first push.
   */
  ensureTable(table: string, columns?: ColumnDef[]): Promise<void>;

  /**
   * Resolve a conflict between local and remote records
   */
  resolveConflict<T extends ActiveRecord>(
    local: T,
    remote: T,
    strategy?: ConflictStrategy
  ): Promise<T>;
}

/**
 * Base adapter class with common functionality
 * All concrete adapters should extend this class
 */
export abstract class BaseAdapter implements SyncAdapter {
  config: AdapterConfig = { url: '' };
  state: SyncState = {
    lastSyncAt: null,
    lastPushAt: null,
    lastPullAt: null,
    status: SyncStatus.IDLE,
    pendingOperations: 0
  };

  protected connected = false;
  protected conflictResolver?: (
    local: unknown,
    remote: unknown
  ) => Promise<unknown>;

  /**
   * Connect to the remote database
   */
  abstract connect(config: AdapterConfig): Promise<void>;

  /**
   * Disconnect from the remote database
   */
  abstract disconnect(): Promise<void>;

  /**
   * Check if currently connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Pull records from remote (must be implemented by subclass)
   */
  abstract pull<T extends ActiveRecord>(query: SyncQuery): Promise<T[]>;

  /**
   * Push records to remote (must be implemented by subclass)
   */
  abstract push<T extends ActiveRecord>(
    records: T[],
    options?: PushOptions
  ): Promise<SyncResult>;

  /**
   * Get remote schema (must be implemented by subclass)
   */
  abstract getRemoteSchema(table: string): Promise<TableSchema>;

  /**
   * Apply migration to remote (must be implemented by subclass)
   */
  abstract applyMigration(migration: SyncMigration): Promise<void>;

  async ensureTable(_table: string, _columns?: ColumnDef[]): Promise<void> {
    // no-op by default; subclasses may override
  }

  /**
   * Resolve conflict using specified strategy
   */
  async resolveConflict<T extends ActiveRecord>(
    local: T,
    remote: T,
    strategy: ConflictStrategy = ConflictStrategy.LOCAL_WINS
  ): Promise<T> {
    switch (strategy) {
      case ConflictStrategy.LOCAL_WINS:
        return local;

      case ConflictStrategy.REMOTE_WINS:
        return remote;

      case ConflictStrategy.LAST_WRITE_WINS: {
        const localTime = (local as unknown as Record<string, Date>).updatedAt || new Date(0);
        const remoteTime = (remote as unknown as Record<string, Date>).updatedAt || new Date(0);
        return localTime > remoteTime ? local : remote;
      }

      case ConflictStrategy.CUSTOM:
        if (this.conflictResolver) {
          return (await this.conflictResolver(local, remote)) as T;
        }
        return local;

      default:
        return local;
    }
  }

  /**
   * Set a custom conflict resolver function
   */
  setConflictResolver(
    resolver: (local: unknown, remote: unknown) => Promise<unknown>
  ): void {
    this.conflictResolver = resolver;
  }

  /**
   * Update sync state
   */
  protected updateState(updates: Partial<SyncState>): void {
    this.state = { ...this.state, ...updates };
  }

  /**
   * Helper to validate config has required fields
   */
  protected validateConfig(requiredFields: (keyof AdapterConfig)[]): void {
    for (const field of requiredFields) {
      if (!this.config[field]) {
        throw new Error(`Missing required config field: ${field}`);
      }
    }
  }
}
