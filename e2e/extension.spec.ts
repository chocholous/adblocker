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

// Network-rules-as-cosmetic fixture: an ad iframe sourced from a known ad host
// (doubleclick.net, matched by the engine's NETWORK filters) next to a benign
// first-party iframe and image. The extension must HIDE only the ad-sourced
// iframe and leave the real content visible — we never block the request, the
// iframe still loads (or fails to), it just gets display:none afterwards.
const NET_FIXTURE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>net fixture</title></head>
<body>
  <div id="content">real content</div>
  <iframe id="ad-frame" src="https://doubleclick.net/ad?slot=1" width="300" height="250"></iframe>
  <iframe id="real-frame" src="/embed" width="300" height="250"></iframe>
  <img id="real-img" src="/photo.png" width="200" height="200">
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
    const server = http.createServer((req, res) => {
      const path = (req.url ?? '/').split('?')[0];
      if (path === '/net') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(NET_FIXTURE_HTML);
        return;
      }
      if (path === '/embed') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<!doctype html><html><body>local embed</body></html>');
        return;
      }
      if (path === '/photo.png') {
        // 1x1 transparent PNG so the first-party <img> "loads" without network.
        const png = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/QPgAAAAAElFTkSuQmCC',
          'base64',
        );
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(png);
        return;
      }
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

/**
 * Network-rules-as-cosmetic: an iframe whose `src` points at an ad host
 * (doubleclick.net) is matched by the engine's NETWORK filters and HIDDEN after
 * load, while a benign first-party iframe and image stay visible. This proves
 * the content↔background matcher path works end-to-end and is conservative
 * (only the ad-sourced element is hidden — no request blocking).
 */
test('hides an ad-sourced iframe, keeps first-party iframe + image', async ({
  context,
  baseURL,
}) => {
  const page = await context.newPage();
  await page.goto(`${baseURL}/net`);

  // The hide pass runs async (debounced) after the background matcher replies,
  // so wait for the ad iframe to be hidden rather than asserting immediately.
  await expect(page.locator('#ad-frame')).toBeHidden({ timeout: 10000 });

  // Real content is untouched.
  await expect(page.locator('#content')).toBeVisible();
  await expect(page.locator('#real-frame')).toBeVisible();
  await expect(page.locator('#real-img')).toBeVisible();
});
