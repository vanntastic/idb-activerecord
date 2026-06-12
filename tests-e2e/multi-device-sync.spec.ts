import { test, expect, type Page } from '@playwright/test';

// The multi-device-sync demo is fully self-contained: two IndexedDB databases
// (phone + laptop) sync through an in-memory CloudAdapter. State lives entirely
// in the page, and the demo resets both databases on load, so each test gets a
// clean, isolated environment in its own browser context.

const SEED = 100; // phone records to create per test (keeps runs fast)

test.describe('Multi-Device Sync Demo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/multi-device-sync/');
    await page.waitForSelector('h1');
    // On boot the demo resets and seeds 2 laptop-only tasks, then re-enables
    // the controls. Wait for that to settle before interacting.
    await expect(page.locator('#laptopCount')).toHaveText('2', { timeout: 10000 });
    await expect(page.locator('#seedBtn')).toBeEnabled();
  });

  async function seedPhone(page: Page, count = SEED): Promise<void> {
    await page.selectOption('#seedCount', String(count));
    await page.click('#seedBtn');
    await expect(page.locator('#mobileCount')).toHaveText(String(count), { timeout: 30000 });
    await expect(page.locator('#seedBtn')).toBeEnabled();
  }

  async function syncPhone(page: Page): Promise<void> {
    await page.click('#syncMobileBtn');
    await expect(page.locator('#syncMobileBtn')).toBeEnabled({ timeout: 30000 });
  }

  async function syncLaptop(page: Page): Promise<void> {
    await page.click('#syncLaptopBtn');
    await expect(page.locator('#syncLaptopBtn')).toBeEnabled({ timeout: 30000 });
  }

  test('boots with a seeded laptop, empty phone and empty cloud', async ({ page }) => {
    await expect(page.locator('#mobileCount')).toHaveText('0');
    await expect(page.locator('#laptopCount')).toHaveText('2');
    await expect(page.locator('#cloudCount')).toHaveText('0');
  });

  test('phone push uploads all seeded records to the cloud', async ({ page }) => {
    await seedPhone(page);
    await expect(page.locator('#mobileCount')).toHaveText(String(SEED));

    await syncPhone(page);

    // Phone pushed all records; cloud now holds them.
    await expect(page.locator('#cloudCount')).toHaveText(String(SEED));
    await expect(page.locator('#log')).toContainText(`pushed`);
  });

  test('laptop reconciles: pulls thousands from phone while pushing its own local records', async ({ page }) => {
    // Phone seeds + uploads its dataset.
    await seedPhone(page);
    await syncPhone(page);
    await expect(page.locator('#cloudCount')).toHaveText(String(SEED));

    // Laptop has 2 local-only tasks. Syncing pushes those up AND pulls the
    // phone's entire dataset down.
    await syncLaptop(page);

    // Cloud = phone records + laptop's 2 local records.
    await expect(page.locator('#cloudCount')).toHaveText(String(SEED + 2));
    // Laptop now holds everything: its 2 + the phone's SEED records.
    await expect(page.locator('#laptopCount')).toHaveText(String(SEED + 2));
    // Phone is unchanged at this point.
    await expect(page.locator('#mobileCount')).toHaveText(String(SEED));
  });

  test('a newly created laptop task propagates to the phone after a round-trip', async ({ page }) => {
    await seedPhone(page);
    await syncPhone(page);
    await syncLaptop(page);
    await expect(page.locator('#laptopCount')).toHaveText(String(SEED + 2));

    // Add a brand-new task on the laptop and push it up.
    await page.click('#laptopAddBtn');
    await expect(page.locator('#laptopCount')).toHaveText(String(SEED + 3));
    await syncLaptop(page);
    await expect(page.locator('#cloudCount')).toHaveText(String(SEED + 3));

    // The phone's pull is incremental (records with updatedAt > its last pull
    // cursor). The freshly-created laptop task has a newer timestamp than the
    // phone's cursor, so it propagates: phone goes from SEED to SEED + 1.
    // (The laptop's two boot-seeded tasks predate the cursor and are not
    // re-pulled — the expected behaviour of timestamp-based incremental sync.)
    await syncPhone(page);
    await expect(page.locator('#mobileCount')).toHaveText(String(SEED + 1));
  });

  test('a soft-delete on the phone propagates a tombstone to the laptop', async ({ page }) => {
    await seedPhone(page);
    await syncPhone(page);
    await syncLaptop(page);
    await expect(page.locator('#laptopCount')).toHaveText(String(SEED + 2));

    // Delete a task on the phone (soft delete → tombstone) and sync it up.
    await page.click('#mobileDeleteBtn');
    await expect(page.locator('#mobileCount')).toHaveText(String(SEED - 1));
    await syncPhone(page);

    // Laptop pulls the tombstone and drops the record from its active count.
    await syncLaptop(page);
    await expect(page.locator('#laptopCount')).toHaveText(String(SEED + 1));
  });

  test('reset returns the demo to its initial state', async ({ page }) => {
    await seedPhone(page);
    await syncPhone(page);
    await expect(page.locator('#cloudCount')).toHaveText(String(SEED));

    await page.click('#resetBtn');

    await expect(page.locator('#mobileCount')).toHaveText('0', { timeout: 10000 });
    await expect(page.locator('#laptopCount')).toHaveText('2');
    await expect(page.locator('#cloudCount')).toHaveText('0');
    await expect(page.locator('#seedBtn')).toBeEnabled();
  });
});
