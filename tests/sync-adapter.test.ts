import { describe, it, expect } from 'vitest';
import {
  BaseAdapter,
  ConflictStrategy,
  SyncStatus,
  SyncMigration
} from '../src/sync-adapter.js';
import { ActiveRecord } from '../src/activerecord.js';

// --- Test BaseAdapter conflict resolution ---

class TestAdapter extends BaseAdapter {
  async connect(config: import('../src/sync-adapter.js').AdapterConfig): Promise<void> {
    this.config = config;
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async pull(): Promise<never[]> {
    return [];
  }

  async push(): Promise<import('../src/sync-adapter.js').SyncResult> {
    return { pushed: 0, pulled: 0, conflicts: 0, errors: [], timestamp: new Date() };
  }

  async getRemoteSchema(): Promise<import('../src/sync-adapter.js').TableSchema> {
    return { name: '', columns: [], indexes: [] };
  }

  async applyMigration(): Promise<void> {}
}

describe('BaseAdapter', () => {
  it('should start disconnected', () => {
    const adapter = new TestAdapter();
    expect(adapter.isConnected()).toBe(false);
    expect(adapter.state.status).toBe(SyncStatus.IDLE);
  });

  it('should connect and disconnect', async () => {
    const adapter = new TestAdapter();
    await adapter.connect({ url: 'http://test' });
    expect(adapter.isConnected()).toBe(true);

    await adapter.disconnect();
    expect(adapter.isConnected()).toBe(false);
  });

  describe('resolveConflict', () => {
    it('should return local with LOCAL_WINS', async () => {
      const adapter = new TestAdapter();
      const local = { id: 1, name: 'local' };
      const remote = { id: 1, name: 'remote' };

      const result = await adapter.resolveConflict(
        local as unknown as ActiveRecord,
        remote as unknown as ActiveRecord,
        ConflictStrategy.LOCAL_WINS
      );
      expect(result).toBe(local);
    });

    it('should return remote with REMOTE_WINS', async () => {
      const adapter = new TestAdapter();
      const local = { id: 1, name: 'local' };
      const remote = { id: 1, name: 'remote' };

      const result = await adapter.resolveConflict(
        local as unknown as ActiveRecord,
        remote as unknown as ActiveRecord,
        ConflictStrategy.REMOTE_WINS
      );
      expect(result).toBe(remote);
    });

    it('should return the newer record with LAST_WRITE_WINS', async () => {
      const adapter = new TestAdapter();
      const oldRecord = { id: 1, name: 'old', updatedAt: new Date('2024-01-01') };
      const newRecord = { id: 1, name: 'new', updatedAt: new Date('2024-02-01') };

      const result = await adapter.resolveConflict(
        oldRecord as unknown as ActiveRecord,
        newRecord as unknown as ActiveRecord,
        ConflictStrategy.LAST_WRITE_WINS
      );
      expect(result).toBe(newRecord);
    });

    it('should use custom resolver', async () => {
      const adapter = new TestAdapter();
      adapter.setConflictResolver(async (_local, _remote) => {
        return { id: 3, name: 'merged' };
      });

      const local = { id: 1, name: 'local' };
      const remote = { id: 2, name: 'remote' };

      const result = await adapter.resolveConflict(
        local as unknown as ActiveRecord,
        remote as unknown as ActiveRecord,
        ConflictStrategy.CUSTOM
      );
      expect((result as unknown as { name: string }).name).toBe('merged');
    });
  });

  it('should throw when config is missing required fields', () => {
    const adapter = new TestAdapter();
    expect(() => adapter['validateConfig'](['url'])).toThrow('Missing required config field: url');
  });
});

// --- Test SyncMigration type ---

describe('SyncMigration', () => {
  it('should define a valid migration', () => {
    const migration: SyncMigration = {
      version: 1,
      name: 'create_users',
      up: async () => {},
      down: async () => {}
    };

    expect(migration.version).toBe(1);
    expect(migration.name).toBe('create_users');
  });
});

describe('ConflictStrategy enum', () => {
  it('should have all strategies', () => {
    expect(ConflictStrategy.LOCAL_WINS).toBe('local');
    expect(ConflictStrategy.REMOTE_WINS).toBe('remote');
    expect(ConflictStrategy.LAST_WRITE_WINS).toBe('timestamp');
    expect(ConflictStrategy.CUSTOM).toBe('custom');
  });
});

describe('SyncStatus enum', () => {
  it('should have all statuses', () => {
    expect(SyncStatus.IDLE).toBe('idle');
    expect(SyncStatus.SYNCING).toBe('syncing');
    expect(SyncStatus.ERROR).toBe('error');
    expect(SyncStatus.OFFLINE).toBe('offline');
  });
});
