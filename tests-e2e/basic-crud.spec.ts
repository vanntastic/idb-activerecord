import { test, expect } from '@playwright/test';

test.describe('Basic CRUD Demo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/basic-crud/');
    // Wait for the app to initialize
    await page.waitForSelector('h1');
  });

  test('should create and display a new user', async ({ page }) => {
    page.on('dialog', dialog => dialog.accept());
    // Create a user
    await page.fill('#userName', 'Alice Smith');
    await page.fill('#userEmail', 'alice@example.com');
    await page.fill('#userAge', '25');
    await page.click('button:has-text("Create User")');

    // Verify stats updated
    await expect(page.locator('#totalUsers')).toHaveText('1');

    // Load all users and verify
    await page.click('button:has-text("Load All Users")');
    await expect(page.locator('.user-list')).toContainText('Alice Smith');
  });

  test('should find a user by ID', async ({ page }) => {
    // First create a user — capture the UUID from the alert
    let createdId = '';
    page.on('dialog', async dialog => {
      const match = dialog.message().match(/ID:\s*(\S+)/);
      if (match) createdId = match[1];
      await dialog.accept();
    });
    await page.fill('#userName', 'Bob Jones');
    await page.fill('#userEmail', 'bob@example.com');
    await page.fill('#userAge', '30');
    await page.click('button:has-text("Create User")');
    await expect(page.locator('#totalUsers')).toHaveText('1');

    // Find the user by UUID
    await page.fill('#findUserId', createdId);
    await page.click('button:has-text("Find User")');

    // Verify output
    await expect(page.locator('#findOutput')).toContainText('Bob Jones');
    await expect(page.locator('#findOutput')).toContainText('bob@example.com');
  });

  test('should query users by minimum age', async ({ page }) => {
    page.on('dialog', dialog => dialog.accept());
    // Create users of different ages — wait for each to persist before the next
    await page.fill('#userName', 'Child');
    await page.fill('#userEmail', 'child@example.com');
    await page.fill('#userAge', '10');
    await page.click('button:has-text("Create User")');
    await expect(page.locator('#totalUsers')).toHaveText('1');

    await page.fill('#userName', 'Adult');
    await page.fill('#userEmail', 'adult@example.com');
    await page.fill('#userAge', '25');
    await page.click('button:has-text("Create User")');
    await expect(page.locator('#totalUsers')).toHaveText('2');

    // Query for adults (18+)
    await page.fill('#queryAge', '18');
    await page.click('button:has-text("Query Users")');

    // Should only show Adult
    await expect(page.locator('#queryOutput')).toContainText('Adult');
    await expect(page.locator('#queryOutput')).not.toContainText('Child');
  });

  test('should update a user', async ({ page }) => {
    // Create a user — capture the UUID from the alert
    let createdId = '';
    page.on('dialog', async dialog => {
      const match = dialog.message().match(/ID:\s*(\S+)/);
      if (match) createdId = match[1];
      await dialog.accept();
    });
    await page.fill('#userName', 'Update Test');
    await page.fill('#userEmail', 'update@example.com');
    await page.fill('#userAge', '20');
    await page.click('button:has-text("Create User")');
    await expect(page.locator('#totalUsers')).toHaveText('1');

    // Update the user
    await page.fill('#updateUserId', createdId);
    await page.fill('#updateAge', '35');
    await page.click('button:has-text("Update User")');

    // Verify the update by finding the user
    await page.fill('#findUserId', createdId);
    await page.click('button:has-text("Find User")');
    await expect(page.locator('#findOutput')).toContainText('35');
  });

  test('should delete a user', async ({ page }) => {
    // Create a user — capture the UUID from the alert
    let createdId = '';
    page.on('dialog', async dialog => {
      const match = dialog.message().match(/ID:\s*(\S+)/);
      if (match) createdId = match[1];
      await dialog.accept();
    });
    await page.fill('#userName', 'Delete Me');
    await page.fill('#userEmail', 'delete@example.com');
    await page.fill('#userAge', '40');
    await page.click('button:has-text("Create User")');

    // Verify user exists
    await expect(page.locator('#totalUsers')).toHaveText('1');

    // Delete the user by UUID
    await page.fill('#deleteUserId', createdId);
    await page.click('button:has-text("Delete User")');

    // Verify stats updated
    await expect(page.locator('#totalUsers')).toHaveText('0');
  });

  test('should handle IndexedDB persistence across reloads', async ({ page }) => {
    page.on('dialog', dialog => dialog.accept());
    // Create a user
    await page.fill('#userName', 'Persistent');
    await page.fill('#userEmail', 'persistent@example.com');
    await page.fill('#userAge', '50');
    await page.click('button:has-text("Create User")');

    // Verify user exists
    await expect(page.locator('#totalUsers')).toHaveText('1');

    // Reload the page
    await page.reload();
    await page.waitForSelector('h1');

    // User count should persist
    await expect(page.locator('#totalUsers')).toHaveText('1');

    // Load users and verify data persisted
    await page.click('button:has-text("Load All Users")');
    await expect(page.locator('.user-list')).toContainText('Persistent');
  });
});
