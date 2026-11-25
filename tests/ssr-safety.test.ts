import { describe, it, expect, vi } from 'vitest';

describe('SSR Safety & Environment Isolation', () => {
  it('does not throw when importing, defining models, or instantiating Database with undefined indexedDB', async () => {
    // Save original global indexedDB
    const originalIDB = (globalThis as any).indexedDB;

    try {
      // Simulate SSR / Node environment where indexedDB is undefined
      delete (globalThis as any).indexedDB;
      expect((globalThis as any).indexedDB).toBeUndefined();

      // Dynamically import library
      const { Database, ActiveRecord, QueryBuilder } = await import('../src/index');

      // Defining ActiveRecord subclasses in SSR must succeed without throwing
      class User extends ActiveRecord {
        static tableName = 'users';
        static hasMany = { posts: 'posts' };
      }

      class Post extends ActiveRecord {
        static tableName = 'posts';
        static belongsTo = { user: User };
      }

      expect(User.tableName).toBe('users');
      expect(Post.tableName).toBe('posts');

      // Instantiating Database in SSR must succeed without throwing
      const db = new Database('ssr-test-db');
      expect(db).toBeInstanceOf(Database);

      db.registerModel(User);
      db.registerModel(Post);

      // Instantiating QueryBuilder in SSR must succeed without throwing
      const qb = new QueryBuilder('users', null, User);
      expect(qb).toBeInstanceOf(QueryBuilder);

      // Invoking connect() when indexedDB is undefined throws a clear, actionable error
      await expect(db.connect()).rejects.toThrow(
        'IndexedDB is not available in this environment. Database operations require a browser environment or an IndexedDB polyfill.'
      );
    } finally {
      // Restore global indexedDB
      if (originalIDB !== undefined) {
        (globalThis as any).indexedDB = originalIDB;
      }
    }
  });
});
