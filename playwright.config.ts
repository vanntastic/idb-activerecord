import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests-e2e',
  globalSetup: './tests-e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:8080',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Run example servers before tests
  webServer: [
    {
      command: 'node examples/server.js',
      url: 'http://localhost:8080',
      timeout: 120 * 1000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'node examples/sqlite-sync/server.js',
      url: 'http://localhost:3001/health',
      timeout: 120 * 1000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'node examples/turso-sync/server.js',
      url: 'http://localhost:3002/health',
      env: {
        TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL || 'file:/tmp/turso-e2e.db',
      },
      timeout: 120 * 1000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
