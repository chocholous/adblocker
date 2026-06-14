import { defineConfig } from '@playwright/test';

// E2E gate: loads the built extension into real Chromium and drives a page.
// Extensions require a persistent context, so tests run serially.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : 'line',
  use: {
    trace: 'on-first-retry',
  },
});
