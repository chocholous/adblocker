import {
  test as base,
  expect,
  chromium,
  type BrowserContext,
} from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const here = dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = resolve(here, '../.output/chrome-mv3');

// Minimal page with a control element and one that matches a default hide
// selector (`[data-ad]` is in DEFAULT_SETTINGS.hideSelectors).
const FIXTURE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>fixture</title></head>
<body>
  <div id="content">real content</div>
  <div id="banner" data-ad>advertisement</div>
</body></html>`;

/**
 * Fixtures: a Chromium persistent context with the built extension loaded, and a
 * throwaway local HTTP server (content scripts don't run on file:// by default).
 * `--headless=new` runs the full Chromium build headless *with* extension
 * support — so this works in CI without a display server.
 */
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

test('hides elements matching a default selector, keeps real content', async ({
  context,
  baseURL,
}) => {
  const page = await context.newPage();
  await page.goto(`${baseURL}/`);

  await expect(page.locator('#content')).toBeVisible();
  await expect(page.locator('#banner')).toBeHidden();
});

/**
 * The MAIN-world scriptlet spoofs `window.adsbygoogle` to look "loaded" so
 * anti-adblock bait checks pass. It can only do this after the ISOLATED world
 * delivers the spoof config across the world boundary. Both content scripts run
 * at document_start with no guaranteed order, so the handshake (eager push +
 * request/response in lib/bridge.ts) must deliver the config either way.
 *
 * Reading the spoofed global from a page-context script proves the MAIN world
 * received the config — i.e. the handshake completed regardless of load order.
 */
test('MAIN world spoofs adsbygoogle (handshake delivered config)', async ({
  context,
  baseURL,
}) => {
  const page = await context.newPage();
  await page.goto(`${baseURL}/`);

  // `page.evaluate` runs in the page (MAIN) context, where the scriptlet has
  // installed its spoofing getter. With spoof enabled (the default), the getter
  // returns a benign "loaded" ad object.
  const spoofed = await page.evaluate(() => {
    const ads = (window as unknown as { adsbygoogle?: { loaded?: boolean } })
      .adsbygoogle;
    return ads?.loaded === true;
  });

  expect(spoofed).toBe(true);
});
