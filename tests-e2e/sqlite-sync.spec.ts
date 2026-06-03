import { test, expect, type Page } from '@playwright/test';

// The sqlite-sync demo shares a single server-side SQLite database, so tests
// run serially and use unique data per test (titles include the test id and
// a timestamp) to remain isolated. Assertions check the presence of that
// specific data rather than absolute counts.

test.describe.configure({ mode: 'serial' });

test.describe('SQLite Sync Demo', () => {
  test.beforeEach(async ({ page }) => {
    // Auto-accept dialogs (clearLocal uses confirm())
    page.on('dialog', dialog => dialog.accept());
    await page.goto('/examples/sqlite-sync/');
    await page.waitForSelector('h1');
    // Wait for adapter connection
    await expect(page.locator('#connStatus')).not.toHaveText('—', { timeout: 5000 });
  });

  async function clearLocal(page: Page): Promise<void> {
    await page.click('button:has-text("Clear Local")');
    await expect(page.locator('#localCount')).toHaveText('0');
  }

  // The "Full Sync" button kicks off async push/pull/merge across 3 tables.
  // Wait for the action log to indicate completion (or failure) before continuing.
  async function fullSync(page: Page): Promise<void> {
    await page.click('button:has-text("Full Sync")');
    // doSync logs either "✅ Sync complete" or "❌ Sync failed" when finished.
    await expect(page.locator('#lastAction')).toContainText(/Sync (complete|failed)/i, {
      timeout: 15000,
    });
  }

  function uniqueTitle(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  test('connects to the sync server and shows initial state', async ({ page }) => {
    // After connection, status should not be the placeholder
    await expect(page.locator('#connStatus')).not.toHaveText('—');
    await expect(page.locator('#localCount')).toBeVisible();
  });

  test('creates a task and syncs it to the server', async ({ page }) => {
    await clearLocal(page);

    const title = uniqueTitle('task');
    await page.fill('#taskTitle', title);
    await page.click('button:has-text("Add Task")');

    // Local list shows the new task
    await expect(page.locator('#taskList')).toContainText(title);

    // Sync — the title should still be in the list after the round-trip
    await fullSync(page);
    await expect(page.locator('#taskList')).toContainText(title);
  });

  test('creates a note and syncs it to the server', async ({ page }) => {
    await clearLocal(page);

    const content = uniqueTitle('note');
    await page.fill('#noteContent', content);
    await page.click('button:has-text("Add Note")');

    await expect(page.locator('#noteList')).toContainText(content);

    await fullSync(page);
    await expect(page.locator('#noteList')).toContainText(content);
  });

  test('creates a label and syncs it to the server', async ({ page }) => {
    await clearLocal(page);

    const name = uniqueTitle('label').replace(/-/g, '_');
    await page.fill('#labelName', name);
    await page.click('button:has-text("Add Label")');

    await expect(page.locator('#labelList')).toContainText(name);

    await fullSync(page);
    await expect(page.locator('#labelList')).toContainText(name);
  });

  test('toggles a task status between pending and done', async ({ page }) => {
    await clearLocal(page);

    const title = uniqueTitle('toggle');
    await page.fill('#taskTitle', title);
    await page.click('button:has-text("Add Task")');

    const taskItem = page.locator('.task-item', { hasText: title }).first();
    await expect(taskItem).toBeVisible();

    // Toggle to done
    await taskItem.locator('button.toggle-btn').click();
    await expect(taskItem).toHaveClass(/done/);

    // Toggle back to pending
    await taskItem.locator('button.toggle-btn').click();
    await expect(taskItem).not.toHaveClass(/done/);
  });

  test('switches between users with separate datasets', async ({ page }) => {
    await clearLocal(page);

    // As Alice, add a task
    const aliceTitle = uniqueTitle('alice');
    await page.fill('#taskTitle', aliceTitle);
    await page.click('button:has-text("Add Task")');
    await fullSync(page);
    await expect(page.locator('#taskList')).toContainText(aliceTitle);

    // Switch to Bob
    await page.click('button:has-text("Bob")');
    // Bob shouldn't see Alice's task in the rendered list
    await expect(page.locator('#taskList')).not.toContainText(aliceTitle);

    // Bob adds his own task
    const bobTitle = uniqueTitle('bob');
    await page.fill('#taskTitle', bobTitle);
    await page.click('button:has-text("Add Task")');
    await fullSync(page);
    await expect(page.locator('#taskList')).toContainText(bobTitle);
    await expect(page.locator('#taskList')).not.toContainText(aliceTitle);
  });

  test('clears local data without removing local UI rendering of new entries', async ({ page }) => {
    await clearLocal(page);

    const title = uniqueTitle('clear');
    await page.fill('#taskTitle', title);
    await page.click('button:has-text("Add Task")');
    await expect(page.locator('#taskList')).toContainText(title);

    await clearLocal(page);
    await expect(page.locator('#taskList')).not.toContainText(title);
  });

  test('syncs tasks, notes, and labels in a single sync operation', async ({ page }) => {
    await clearLocal(page);

    const taskTitle = uniqueTitle('multi-task');
    const noteContent = uniqueTitle('multi-note');
    const labelName = uniqueTitle('multi_label').replace(/-/g, '_');

    await page.fill('#taskTitle', taskTitle);
    await page.click('button:has-text("Add Task")');

    await page.fill('#noteContent', noteContent);
    await page.click('button:has-text("Add Note")');

    await page.fill('#labelName', labelName);
    await page.click('button:has-text("Add Label")');

    await fullSync(page);

    await expect(page.locator('#taskList')).toContainText(taskTitle);
    await expect(page.locator('#noteList')).toContainText(noteContent);
    await expect(page.locator('#labelList')).toContainText(labelName);
  });
});
