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

// Synthetic ad-heavy page modeled on the real-site vision study. Each ad /
// consent / newsletter node should be hidden by a DEFAULT_SETTINGS selector,
// while #article (real content) must stay visible. Class names deliberately mix
// `ad`-bearing tokens that must NOT be matched (e.g. `header__nav`, the article
// body) with the precise tokens that must be matched.
const FIXTURE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>ad-heavy fixture</title></head>
<body>
  <header class="header__nav">site header (real)</header>

  <!-- Real article content that must survive. Contains "ad" substrings on
       purpose (download, headline) to prove no broad [class*="ad"] matcher. -->
  <main id="article" class="article-body download-headline">
    <h1>Real Article Headline</h1>
    <p>This is genuine reader-facing content and must remain visible.</p>
  </main>

  <!-- Ads / native-ad widgets -->
  <ins id="adsense" class="adsbygoogle" data-ad-client="ca-pub-000"></ins>
  <iframe id="google_ads_iframe_1" title="3rd party ad"></iframe>
  <div id="adslot" class="ad-slot">ad slot</div>
  <div id="taboola-below" class="taboola-feed">taboola widget</div>

  <!-- Consent banner -->
  <div id="onetrust-banner-sdk">we value your privacy</div>

  <!-- Newsletter prompt -->
  <div id="newsletter-box" class="newsletter-signup">subscribe to our newsletter</div>
</body></html>`;

/**
 * Same harness as e2e/extension.spec.ts: a persistent Chromium context with the
 * built extension loaded (default settings) and a throwaway local HTTP server
 * (content scripts don't run on file://). `--headless=new` keeps extension
 * support in CI.
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

// Every ad/consent/newsletter node and the selector that should hide it.
const HIDDEN = [
  { id: 'adsense', why: 'ins.adsbygoogle' },
  { id: 'google_ads_iframe_1', why: 'iframe[id^="google_ads_iframe"]' },
  { id: 'adslot', why: '[class*="ad-slot"]' },
  { id: 'taboola-below', why: '[class*="taboola"]' },
  { id: 'onetrust-banner-sdk', why: '#onetrust-banner-sdk' },
  { id: 'newsletter-box', why: '[class*="newsletter"]' },
] as const;

test('default selectors hide ads/consent/newsletter, keep real content', async ({
  context,
  baseURL,
}) => {
  const page = await context.newPage();
  await page.goto(`${baseURL}/`);

  // Real content stays visible; ad-bearing substrings in its classes must not
  // trip a broad matcher.
  await expect(page.locator('#article')).toBeVisible();
  await expect(page.locator('.header__nav')).toBeVisible();

  for (const { id, why } of HIDDEN) {
    const el = page.locator(`#${id}`);
    // Present in the DOM (hidden via display:none, not removed).
    await expect(el, `#${id} should remain in the DOM`).toHaveCount(1);
    // Hidden by its default selector (${why}).
    await expect(el, `#${id} should be hidden by ${why}`).toBeHidden();
  }
});

test('hiding via display:none keeps nodes attached (no remove)', async ({
  context,
  baseURL,
}) => {
  const page = await context.newPage();
  await page.goto(`${baseURL}/`);

  // removeSelectors is empty by design (remove() crashes React SPAs), so every
  // hidden ad node must still be attached to the DOM.
  const stillAttached = await page.evaluate(
    (ids) => ids.every((id) => document.getElementById(id) !== null),
    HIDDEN.map((h) => h.id),
  );
  expect(stillAttached).toBe(true);

  // And the real content node must not be matched by any default selector.
  const articleHidden = await page.evaluate(() => {
    const el = document.getElementById('article');
    return el ? getComputedStyle(el).display === 'none' : true;
  });
  expect(articleHidden).toBe(false);
});
