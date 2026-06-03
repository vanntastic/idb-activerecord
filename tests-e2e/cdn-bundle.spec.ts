import { test, expect } from '@playwright/test';

// Navigate to a real served page first so the bundle script and IndexedDB
// have a proper origin (about:blank from setContent breaks both).

test.describe('CDN Bundle Loading', () => {
  test('should load library from CDN and expose global IDBActiveRecord', async ({ page }) => {
    await page.goto('/examples/basic-crud/');

    const exports = await page.evaluate(async () => {
      // Load the minified IIFE bundle into the live page
      const script = document.createElement('script');
      script.src = '/dist/idb-activerecord.min.js';
      const loaded = new Promise<void>((resolve, reject) => {
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('failed to load bundle'));
      });
      document.head.appendChild(script);
      await loaded;
      const lib = (window as unknown as { IDBActiveRecord?: Record<string, unknown> }).IDBActiveRecord;
      return lib ? Object.keys(lib).sort() : null;
    });

    expect(exports).not.toBeNull();
    expect(exports).toContain('ActiveRecord');
    expect(exports).toContain('Database');
  });

  test('should create Database and ActiveRecord using CDN bundle', async ({ page }) => {
    await page.goto('/examples/basic-crud/');

    const result = await page.evaluate(async () => {
      const script = document.createElement('script');
      script.src = '/dist/idb-activerecord.min.js';
      await new Promise<void>((resolve, reject) => {
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('failed to load bundle'));
        document.head.appendChild(script);
      });

      const { Database, ActiveRecord } = (window as any).IDBActiveRecord;

      class TestItem extends ActiveRecord {
        static tableName = 'test_items';
      }

      const db = new Database('cdn-test-' + Date.now());
      db.registerModel(TestItem);
      await db.connect();

      const item = await TestItem.create({ title: 'From CDN' });
      const found = await TestItem.find(item.id);
      return found ? (found as any).title : null;
    });

    expect(result).toBe('From CDN');
  });
});
