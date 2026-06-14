import {
  test as base,
  expect,
  chromium,
  type BrowserContext,
  type Worker,
} from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const here = dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = resolve(here, '../.output/chrome-mv3');

// Two structurally identical cards. A plain CSS selector (`div.card`) hits BOTH;
// only a procedural `:has-text(Sponsored)` rule can target the ad without also
// hiding the real article — the thing plain CSS fundamentally cannot do.
const FIXTURE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>procedural fixture</title></head>
<body>
  <div class="card" id="ad">Sponsored partner content</div>
  <div class="card" id="real">Genuine editorial story</div>
</body></html>`;

const test = base.extend<{ context: BrowserContext; baseURL: string }>({
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
  baseURL: async ({}, use) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(FIXTURE_HTML);
    });
    await new Promise<void>((resolveListen) => server.listen(0, resolveListen));
    const { port } = server.address() as AddressInfo;
    await use(`http://localhost:${port}`);
    server.close();
  },
});

/**
 * Resolve the extension's `chrome-extension://` origin from its background
 * service worker. The worker can register slightly after launch, so we wait for
 * one whose URL is a chrome-extension URL.
 */
async function getExtensionOrigin(context: BrowserContext): Promise<string> {
  // Node's `URL.origin` returns "null" for non-special schemes like
  // chrome-extension://, so build the origin from the parsed host instead.
  const fromWorker = (w: Worker | undefined): string | null => {
    const url = w?.url() ?? '';
    if (!url.startsWith('chrome-extension://')) return null;
    return `chrome-extension://${new URL(url).host}`;
  };
  const existing = context.serviceWorkers().map(fromWorker).find(Boolean);
  if (existing) return existing;
  for (let i = 0; i < 20; i += 1) {
    const worker = await context.waitForEvent('serviceworker');
    const origin = fromWorker(worker);
    if (origin) return origin;
  }
  throw new Error('Could not resolve the extension service worker origin.');
}

test('domain-scoped procedural rule hides a CSS-untargetable element and survives export→clear→import', async ({
  context,
  baseURL,
}) => {
  const extOrigin = await getExtensionOrigin(context);
  const popupUrl = `${extOrigin}/popup.html`;

  // The fixture is served on localhost; scope the cosmetic rule to that host so
  // we also exercise per-hostname resolution (selectorsForHostname).
  const cosmeticFilters = 'localhost##div.card:has-text(Sponsored)';

  // Seed settings by driving the popup UI we built (the real user flow): type
  // the cosmetic-filter text and Save. The popup writes through settingsItem, so
  // this also exercises the storage path the content script watches.
  const popup = await context.newPage();
  await popup.goto(popupUrl);
  await popup.fill('#cosmeticFilters', cosmeticFilters);
  await popup.click('#save');
  await expect(popup.locator('#status')).toHaveText('Saved');

  // Load the fixture: the procedural rule must hide only the sponsored card.
  const page = await context.newPage();
  await page.goto(`${baseURL}/`);
  await expect(page.locator('#ad')).toBeHidden();
  await expect(page.locator('#real')).toBeVisible();

  // --- The AC round-trip: export, clear, import, still hidden. ---
  await popup.bringToFront();
  await popup.reload();
  await popup.click('#export');
  const exported = await popup.inputValue('#ioText');
  expect(exported).toContain('cosmeticFilters');
  expect(exported).toContain(':has-text(Sponsored)');

  // Clear all settings back to defaults (no cosmeticFilters) and confirm the ad
  // reappears, proving the rule — not some default — was responsible.
  await popup.fill('#cosmeticFilters', '');
  await popup.click('#save');
  await expect(popup.locator('#status')).toHaveText('Saved');
  await page.reload();
  await expect(page.locator('#ad')).toBeVisible();

  // Import the previously-exported JSON and confirm the element is hidden again.
  await popup.fill('#ioText', exported);
  await popup.click('#import');
  await expect(popup.locator('#ioStatus')).toHaveText('Imported.');
  // The imported value is reflected back into the form.
  await expect(popup.locator('#cosmeticFilters')).toHaveValue(cosmeticFilters);

  await page.reload();
  await expect(page.locator('#ad')).toBeHidden();
  await expect(page.locator('#real')).toBeVisible();
});
