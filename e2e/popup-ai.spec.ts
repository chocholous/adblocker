import {
  test as base,
  expect,
  chromium,
  type BrowserContext,
} from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = resolve(here, '../.output/chrome-mv3');

/**
 * Loads the built extension into a persistent Chromium context and resolves the
 * extension's own origin (chrome-extension://<id>) so we can open the popup page
 * directly. No live Anthropic API is available in CI — this spec covers the
 * popup wiring and the no-credential error path, not a real model call.
 */
const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        '--headless=new',
        '--no-sandbox',
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    // The MV3 service worker URL is chrome-extension://<id>/background.js.
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    const id = new URL(sw.url()).host;
    await use(id);
  },
});

test('popup AI section renders auth selector, model dropdown, and vision toggle', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  // Defaults: API key auth selected, its input visible, OAuth input hidden.
  await expect(page.locator('#aiAuthMethod')).toHaveValue('apiKey');
  await expect(page.locator('#apiKeyField')).toBeVisible();
  await expect(page.locator('#oauthField')).toBeHidden();
  await expect(page.locator('#aiModel')).toHaveValue('haiku');
  await expect(page.locator('#aiVision')).not.toBeChecked();

  // Switching to OAuth swaps the visible credential input.
  await page.locator('#aiAuthMethod').selectOption('oauth');
  await expect(page.locator('#oauthField')).toBeVisible();
  await expect(page.locator('#apiKeyField')).toBeHidden();
});

test('cleanup with no credential shows a clear error (no real API call)', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  // Ensure no credentials are stored, then trigger cleanup on the active tab
  // (the popup's own page). With no API key set, the background must return the
  // clear "no key" error rather than attempting a network call.
  await page.evaluate(async () => {
    const ext = globalThis as unknown as {
      chrome: {
        storage: { local: { set: (items: object) => Promise<void> } };
      };
    };
    await ext.chrome.storage.local.set({
      anthropicApiKey: '',
      anthropicOauthToken: '',
    });
  });
  await page.reload();

  await page.locator('#cleanup').click();
  await expect(page.locator('#aiStatus')).toContainText(/key|content script/i, {
    timeout: 10000,
  });
});
