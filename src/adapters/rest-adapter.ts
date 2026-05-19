// REST API Sync Adapter
// Generic adapter for syncing with any REST API backend

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

export interface RestAdapterConfig extends AdapterConfig {
  /** Base URL for the REST API */
  url: string;
  /** Optional auth token */
  authToken?: string;
  /** Optional API key */
  apiKey?: string;
  /** Custom headers to send with each request */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Endpoint path pattern (default: /{table}) */
  endpointPattern?: string;
}

/**
 * Generic REST API Sync Adapter
 *
 * Works with any RESTful backend that exposes the following endpoints:
 *
 * | Method | Endpoint | Purpose |
 * |--------|----------|---------|
 * | GET | `/health` | Optional health check during `connect()` |
 * | GET | `/{table}?since=&limit=&offset=` | Pull records from remote |
 * | POST | `/{table}` | Push records to remote (body: JSON array) |
 * | GET | `/schema/{table}` | Fetch remote schema |
 * | POST | `/migrations` | Apply a migration (body: `{ version, name }`) |
 *
 * The `/{table}` path is configurable via `endpointPattern` (default: `/{table}`).
 *
 * Authentication is sent via `Authorization: Bearer <authToken>` or `X-API-Key: <apiKey>`.
 * All requests include `Content-Type: application/json`.
 *
 * Conflict resolution is handled by `BaseAdapter.resolveConflict()` and does not
 * require a dedicated endpoint — conflicts are detected during pull/push and
 * resolved client-side before the record is persisted.
 */
export class RestAdapter extends BaseAdapter {
  private abortController?: AbortController;

  async connect(config: RestAdapterConfig): Promise<void> {
    this.config = {
      timeout: 30000,
      endpointPattern: '/{table}',
      ...config
    };

    this.validateConfig(['url']);

    // Test connection with a simple GET request
    try {
      await this.request('GET', '/health');
      this.connected = true;
      this.updateState({ status: SyncStatus.IDLE });
    } catch {
      // If health endpoint doesn't exist, still mark as connected
      // The actual API operations will validate connectivity
      this.connected = true;
      this.updateState({ status: SyncStatus.IDLE });
    }
  }

  async disconnect(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.connected = false;
    this.updateState({ status: SyncStatus.IDLE });
  }

  /**
   * Pull records from the REST API
   */
  async pull<T extends ActiveRecord>(query: SyncQuery): Promise<T[]> {
    if (!this.isConnected()) {
      throw new Error('Adapter not connected. Call connect() first.');
    }

    this.updateState({ status: SyncStatus.SYNCING });

    try {
      const endpoint = this.buildEndpoint(query.table);
      const params = new URLSearchParams();

      if (query.since) {
        params.append('since', query.since.toISOString());
      }

      if (query.limit) {
        params.append('limit', query.limit.toString());
      }

      if (query.offset) {
        params.append('offset', query.offset.toString());
      }

      if (query.includeDeleted) {
        params.append('include_deleted', 'true');
      }

      // Add where clauses as query params
      if (query.where) {
        Object.entries(query.where).forEach(([key, value]) => {
          params.append(key, String(value));
        });
      }

      const url = params.toString()
        ? `${endpoint}?${params.toString()}`
        : endpoint;

      const response = await this.request('GET', url);
      const data = await response.json() as T[];

      this.updateState({
        lastPullAt: new Date(),
        status: SyncStatus.IDLE
      });

      return data;
    } catch (error) {
      this.updateState({ status: SyncStatus.ERROR });
      throw error;
    }
  }

  /**
   * Push records to the REST API
   */
  async push<T extends ActiveRecord>(
    records: T[],
    options: PushOptions = {}
  ): Promise<SyncResult> {
    if (!this.isConnected()) {
      throw new Error('Adapter not connected. Call connect() first.');
    }

    if (records.length === 0) {
      return {
        pushed: 0,
        pulled: 0,
        conflicts: 0,
        errors: [],
        timestamp: new Date()
      };
    }

    this.updateState({ status: SyncStatus.SYNCING });

    const result: SyncResult = {
      pushed: 0,
      pulled: 0,
      conflicts: 0,
      errors: [],
      timestamp: new Date()
    };

    const batchSize = options.batchSize || 100;

    try {
      // Process in batches
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        const record = batch[0]!;
        const RecordClass = record.constructor as typeof ActiveRecord;
        const table = options.table ||
          (RecordClass as unknown as { tableName?: string }).tableName;

        if (!table) {
          throw new Error('Cannot push records without tableName');
        }

        const endpoint = this.buildEndpoint(table);

        // Send batch to API
        const body = batch.map(r => {
          const data = r as unknown as Record<string, unknown>;
          return data;
        });
        const response = await this.request('POST', endpoint, {
          body: JSON.stringify(body)
        });

        if (response.ok) {
          result.pushed += batch.length;
        } else {
          // Handle errors
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          batch.forEach(record => {
            result.errors.push({
              record: record,
              error: errorData.error || `HTTP ${response.status}`
            });
          });
        }
      }

      this.updateState({
        lastPushAt: new Date(),
        pendingOperations: 0,
        status: SyncStatus.IDLE
      });

      return result;
    } catch (error) {
      this.updateState({ status: SyncStatus.ERROR });
      throw error;
    }
  }

  /**
   * Ensure a table exists on the remote, creating it if missing.
   * POSTs to /schema with { table, columns } — server creates if absent.
   */
  async ensureTable(table: string, columns?: ColumnDef[]): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Adapter not connected. Call connect() first.');
    }
    await this.request('POST', '/schema', {
      body: JSON.stringify({ table, columns: columns ?? [] })
    });
  }

  /**
   * Get schema from REST API
   * Assumes endpoint /schema/{table} exists
   */
  async getRemoteSchema(table: string): Promise<TableSchema> {
    if (!this.isConnected()) {
      throw new Error('Adapter not connected. Call connect() first.');
    }

    const response = await this.request('GET', `/schema/${table}`);
    return await response.json() as TableSchema;
  }

  /**
   * Apply migration via REST API
   * Assumes endpoint /migrations exists
   */
  async applyMigration(migration: SyncMigration): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Adapter not connected. Call connect() first.');
    }

    const response = await this.request('POST', '/migrations', {
      body: JSON.stringify({
        version: migration.version,
        name: migration.name
      })
    });

    if (!response.ok) {
      throw new Error(`Migration failed: ${response.statusText}`);
    }
  }

  /**
   * Build endpoint URL from pattern
   */
  private buildEndpoint(table: string): string {
    const pattern = (this.config as RestAdapterConfig).endpointPattern || '/{table}';
    return pattern.replace('{table}', table);
  }

  /**
   * Make HTTP request with auth and timeout
   */
  private async request(
    method: string,
    path: string,
    options: { body?: string } = {}
  ): Promise<Response> {
    const config = this.config as RestAdapterConfig;
    const url = `${config.url}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...config.headers
    };

    if (config.authToken) {
      headers['Authorization'] = `Bearer ${config.authToken}`;
    }

    if (config.apiKey) {
      headers['X-API-Key'] = config.apiKey;
    }

    this.abortController = new AbortController();
    const timeoutId = setTimeout(
      () => this.abortController?.abort(),
      config.timeout || 30000
    );

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: options.body,
        signal: this.abortController.signal
      });

      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout');
      }

      throw error;
    }
  }
}
