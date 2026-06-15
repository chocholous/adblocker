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

// `chrome` is the extension API available inside the service-worker context
// (sw.evaluate runs there). Declared loosely since this file is type-checked in
// the Node/test config, which has no extension typings.
declare const chrome: {
  tabs: {
    query: (q: unknown) => Promise<{ id?: number }[]>;
    sendMessage: (id: number, msg: unknown) => Promise<unknown>;
  };
  storage: { sync: { get: (key: string) => Promise<Record<string, unknown>> } };
};

const here = dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = resolve(here, '../.output/chrome-mv3');

// A page with a clearly-targetable element (`#pick-me`, a unique id) that does
// NOT match any default hide selector, plus real content that must stay visible.
const PICK_FIXTURE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>picker fixture</title>
<style>
  #pick-me { position: fixed; top: 40px; left: 40px; width: 200px; height: 120px; background: #c33; }
  #content { padding: 240px 0 0 0; }
</style></head>
<body>
  <div id="content">real content</div>
  <div id="pick-me">pick me</div>
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
      res.end(PICK_FIXTURE_HTML);
    });
    await new Promise<void>((resolveListen) => server.listen(0, resolveListen));
    const { port } = server.address() as AddressInfo;
    await use(`http://localhost:${port}`);
    server.close();
  },
});

/**
 * Reach the extension's service worker so we can read the persisted settings
 * (the SW context is the one with chrome.storage access).
 */
async function getServiceWorker(context: BrowserContext) {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  return sw;
}

/**
 * End-to-end element picker: trigger the picker via `sch:startPicker`, select
 * the target element by clicking at its location, confirm Hide via the toolbar
 * inside the closed shadow DOM, then assert the element is hidden, a selector
 * was persisted to settings, and it stays hidden after a reload.
 */
test('picks an element, hides it, persists the selector, survives reload', async ({
  context,
  baseURL,
}) => {
  const page = await context.newPage();
  await page.goto(`${baseURL}/`);

  await expect(page.locator('#pick-me')).toBeVisible();
  await expect(page.locator('#content')).toBeVisible();

  // Trigger the picker the same way the popup does: send the runtime message to
  // the active tab from the service-worker (extension) context.
  const sw = await getServiceWorker(context);
  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (tab?.id != null) {
      await chrome.tabs.sendMessage(tab.id, { type: 'sch:startPicker' });
    }
  });

  // Hover then click the target so the picker's elementFromPoint selects it.
  const target = page.locator('#pick-me');
  const bbox = await target.boundingBox();
  expect(bbox).not.toBeNull();
  const cx = bbox!.x + bbox!.width / 2;
  const cy = bbox!.y + bbox!.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.click(cx, cy);

  // The confirm toolbar (with the Hide button) lives inside the picker's CLOSED
  // shadow root, which the page cannot read. The picker publishes the Hide
  // button's on-screen rect onto the page-visible host element as
  // `data-sch-hide-rect`, so we can click it precisely.
  const host = page.locator('#sch-picker-host');
  await expect(host).toHaveAttribute('data-sch-hide-rect', /\d+/, {
    timeout: 5000,
  });
  const rectStr = (await host.getAttribute('data-sch-hide-rect')) ?? '0,0,0,0';
  const nums = rectStr.split(',').map(Number);
  const hl = nums[0] ?? 0;
  const ht = nums[1] ?? 0;
  const hw = nums[2] ?? 0;
  const hh = nums[3] ?? 0;
  await page.mouse.click(hl + hw / 2, ht + hh / 2);

  // After Hide, the selector for #pick-me is persisted and the element hidden.
  await expect(page.locator('#pick-me')).toBeHidden({ timeout: 5000 });

  const persisted = await sw.evaluate(async () => {
    const stored = await chrome.storage.sync.get('settings');
    const settings = (stored.settings ?? {}) as { hideSelectors?: string[] };
    return settings.hideSelectors ?? [];
  });
  expect(persisted).toContain('#pick-me');

  // Real content is untouched.
  await expect(page.locator('#content')).toBeVisible();

  // Persistence across reload: the hider re-applies the saved selector.
  await page.reload();
  await expect(page.locator('#pick-me')).toBeHidden({ timeout: 5000 });
  await expect(page.locator('#content')).toBeVisible();
});
