import { test, expect, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test.describe('Turso Sync Demo', () => {
  test.beforeEach(async ({ page }) => {
    page.on('dialog', dialog => dialog.accept());
    await page.goto('/examples/turso-sync/');
    await page.waitForSelector('h1');
    // Wait for adapter connection
    await expect(page.locator('#connStatus')).not.toHaveText('—', { timeout: 10000 });
  });

  async function clearLocal(page: Page): Promise<void> {
    await page.click('button:has-text("Clear Local")');
    await expect(page.locator('#localCount')).toHaveText('0');
  }

  async function fullSync(page: Page): Promise<void> {
    await page.click('button:has-text("Full Sync")');
    await expect(page.locator('#lastAction')).toContainText(/Sync (complete|failed)/i, {
      timeout: 15000,
    });
  }

  function uniqueTitle(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  test('connects to the Turso sync proxy and shows initial state', async ({ page }) => {
    await expect(page.locator('#connStatus')).not.toHaveText('—');
    await expect(page.locator('#localCount')).toBeVisible();
  });

  test('creates a task and syncs it to the Turso server', async ({ page }) => {
    await clearLocal(page);

    const title = uniqueTitle('turso-task');
    await page.fill('#taskTitle', title);
    await page.click('button:has-text("Add Task")');

    await expect(page.locator('#taskList')).toContainText(title);

    await fullSync(page);
    await expect(page.locator('#taskList')).toContainText(title);
  });

  test('creates a note and syncs it to the Turso server', async ({ page }) => {
    await clearLocal(page);

    const content = uniqueTitle('turso-note');
    await page.fill('#noteContent', content);
    await page.click('button:has-text("Add Note")');

    await expect(page.locator('#noteList')).toContainText(content);

    await fullSync(page);
    await expect(page.locator('#noteList')).toContainText(content);
  });

  test('creates a label and syncs it to the Turso server', async ({ page }) => {
    await clearLocal(page);

    const name = uniqueTitle('turso_label').replace(/-/g, '_');
    await page.fill('#labelName', name);
    await page.click('button:has-text("Add Label")');

    await expect(page.locator('#labelList')).toContainText(name);

    await fullSync(page);
    await expect(page.locator('#labelList')).toContainText(name);
  });

  test('toggles a task status between pending and done', async ({ page }) => {
    await clearLocal(page);

    const title = uniqueTitle('turso-toggle');
    await page.fill('#taskTitle', title);
    await page.click('button:has-text("Add Task")');

    const taskItem = page.locator('.task-item', { hasText: title }).first();
    await expect(taskItem).toBeVisible();

    await taskItem.locator('button.toggle-btn').click();
    await expect(taskItem).toHaveClass(/done/);

    await taskItem.locator('button.toggle-btn').click();
    await expect(taskItem).not.toHaveClass(/done/);
  });

  test('switches between users with separate datasets', async ({ page }) => {
    await clearLocal(page);

    // As Alice, add a task
    const aliceTitle = uniqueTitle('alice-turso');
    await page.fill('#taskTitle', aliceTitle);
    await page.click('button:has-text("Add Task")');
    await fullSync(page);
    await expect(page.locator('#taskList')).toContainText(aliceTitle);

    // Switch to Bob
    await page.click('button:has-text("Bob")');
    await expect(page.locator('#taskList')).not.toContainText(aliceTitle);

    // Bob adds his own task
    const bobTitle = uniqueTitle('bob-turso');
    await page.fill('#taskTitle', bobTitle);
    await page.click('button:has-text("Add Task")');
    await fullSync(page);
    await expect(page.locator('#taskList')).toContainText(bobTitle);
    await expect(page.locator('#taskList')).not.toContainText(aliceTitle);
  });
});
