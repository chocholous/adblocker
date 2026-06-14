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

// (a) A CMP overlay with a working "Reject all" control and a scroll-locked
// body. The handler should click Reject (which removes the overlay) and leave
// scrolling restored; real content stays intact.
const FIXTURE_REJECT = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>reject fixture</title>
<style>body.locked { overflow: hidden; }</style></head>
<body class="locked" style="overflow:hidden">
  <main id="content"><h1>Real Article</h1><p>genuine content</p></main>
  <div id="cmp" class="cookie-consent" role="dialog"
       style="position:fixed;inset:0;background:#000;color:#fff;z-index:9999">
    <p>We value your privacy and use cookies.</p>
    <button id="accept">Accept all</button>
    <button id="reject">Reject all</button>
  </div>
  <script>
    // A realistic CMP: clicking Reject tears down its own overlay and unlocks.
    document.getElementById('reject').addEventListener('click', () => {
      document.getElementById('cmp').remove();
      document.body.classList.remove('locked');
      document.body.style.removeProperty('overflow');
    });
  </script>
</body></html>`;

// (b) A CMP overlay with ONLY an "Accept" control (no reject). The handler
// should hide the overlay and restore scrolling; real content stays intact.
const FIXTURE_HIDE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>hide fixture</title>
<style>body.locked { overflow: hidden; }</style></head>
<body class="locked" style="overflow:hidden">
  <main id="content"><h1>Real Article</h1><p>genuine content</p></main>
  <div id="cmp" class="cookie-consent" role="dialog"
       style="position:fixed;inset:0;background:#000;color:#fff;z-index:9999">
    <p>We value your privacy and use cookies.</p>
    <button id="accept">Accept all</button>
  </div>
</body></html>`;

const test = base.extend<{ context: BrowserContext; server: string }>({
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
  // A server that serves /reject and /hide so each test loads its own fixture.
  server: async ({}, use) => {
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(req.url?.startsWith('/hide') ? FIXTURE_HIDE : FIXTURE_REJECT);
    });
    await new Promise<void>((r) => srv.listen(0, r));
    const { port } = srv.address() as AddressInfo;
    await use(`http://localhost:${port}`);
    srv.close();
  },
});

async function bodyScrollable(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const o = getComputedStyle(document.body).overflowY;
    const oh = getComputedStyle(document.documentElement).overflowY;
    return o !== 'hidden' && oh !== 'hidden';
  });
}

test('(a) reject path: clicks Reject, overlay gone, scrolling restored, content intact', async ({
  context,
  server,
}) => {
  const page = await context.newPage();
  await page.goto(`${server}/reject`);

  // The handler clicks "Reject all", whose handler removes the overlay.
  await expect(page.locator('#cmp')).toHaveCount(0);
  // Real content survives.
  await expect(page.locator('#content')).toBeVisible();
  await expect(page.locator('#content h1')).toHaveText('Real Article');
  // Scrolling is restored.
  expect(await bodyScrollable(page)).toBe(true);
});

test('(b) hide fallback: no reject control -> overlay hidden, scrolling restored, content intact', async ({
  context,
  server,
}) => {
  const page = await context.newPage();
  await page.goto(`${server}/hide`);

  // No reject button exists, so the overlay must be HIDDEN (still in DOM).
  await expect(page.locator('#cmp')).toHaveCount(1);
  await expect(page.locator('#cmp')).toBeHidden();
  // Accept was never clicked (still present inside the hidden overlay).
  await expect(page.locator('#accept')).toHaveCount(1);
  // Real content survives.
  await expect(page.locator('#content')).toBeVisible();
  // Scrolling is restored.
  expect(await bodyScrollable(page)).toBe(true);
});
