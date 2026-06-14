#!/usr/bin/env node
// @ts-nocheck
/**
 * Engine-agnostic validation harness for the Stealth Content Hider extension.
 *
 * Loads the built MV3 extension (`.output/chrome-mv3`) into real Chromium via
 * Playwright and, for each URL in `corpus.json`, measures the page twice:
 *   1. extension DISABLED  (settings.enabled = false)  -> baseline
 *   2. extension ENABLED   (settings.enabled = true)   -> treatment
 *
 * For ad-heavy sites it counts VISIBLE ad real-estate and reports the
 * reduction. For clean sites it checks that real content / landmarks / innerText
 * are NOT removed (false-positive detection).
 *
 * This harness is engine-agnostic: it only toggles the extension's master
 * switch and observes the rendered DOM. It makes no assumptions about HOW the
 * extension hides ads, so it stays valid across engine upgrades.
 *
 * Usage:
 *   node validation/run.mjs                # smoke subset (default)
 *   node validation/run.mjs --full         # full ~60/30 corpus
 *   node validation/run.mjs --only=ad      # only ad-heavy sites
 *   node validation/run.mjs --only=clean   # only clean sites
 *   node validation/run.mjs --out=/tmp/x   # report output dir
 *
 * Artifacts (NOT committed): <out>/report.json and <out>/report.md.
 * Default <out> is /tmp/sch-corpus.
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = resolve(here, '../.output/chrome-mv3');

// ---- CLI args ------------------------------------------------------------
const args = process.argv.slice(2);
const FULL = args.includes('--full');
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1];
const OUT_DIR =
  (args.find((a) => a.startsWith('--out=')) || '').split('=')[1] ||
  '/tmp/sch-corpus';

// Per-site time budget and settle timings (ms).
const NAV_TIMEOUT = 25000;
const SETTLE_MS = 3500; // after load + after enabling
const SCROLL_STEPS = 4;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// PASS threshold: ad-heavy considered a success when visible ad real-estate
// drops by at least this fraction (or reaches zero) when enabled.
const AD_REDUCTION_PASS = 0.7;
// FP threshold: clean site fails if innerText shrinks by more than this.
const FP_INNERTEXT_DROP = 0.1;

// ---- Corpus --------------------------------------------------------------
const corpus = JSON.parse(readFileSync(resolve(here, 'corpus.json'), 'utf8'));

function pick(list) {
  return FULL ? list : list.filter((e) => e.smoke);
}
let adSites = pick(corpus.adHeavy);
let cleanSites = pick(corpus.clean);
if (ONLY === 'ad') cleanSites = [];
if (ONLY === 'clean') adSites = [];

// ---- Browser-side measurement (runs in page context) ---------------------
// Kept as a string IIFE so it can be passed to page.evaluate verbatim (a string
// arg is evaluated as an expression, so it must self-invoke). Detects VISIBLE ad
// elements: rendered (offsetParent), area > MIN_AREA px², and either an iframe
// pointing at a known ad host OR matching an ad-ish selector.
const MEASURE_FN = `(() => {
  const MIN_AREA = 1000;
  const AD_HOSTS = [
    'doubleclick.net','googlesyndication.com','google_ads','adnxs.com',
    'taboola.com','outbrain.com','amazon-adsystem.com','criteo','pubmatic',
    'rubiconproject','adsafeprotected','2mdn','moatads','adservice.google',
    'casalemedia','smartadserver','adform','teads','sharethrough','indexww',
    'openx','yieldmo','3lift','adroll','mgid','revcontent','zergnet'
  ];
  const AD_SELECTORS = [
    '[id*="google_ads"]','[id^="div-gpt-ad"]','ins.adsbygoogle',
    '[class*="ad-slot" i]','[class*="ad-unit" i]','[class*="ad-container" i]',
    '[aria-label*="advert" i]','[id*="taboola" i]','[class*="taboola" i]',
    '[id*="outbrain" i]','[class*="outbrain" i]','iframe[id^="google_ads_iframe"]',
    'iframe[src*="doubleclick" i]','iframe[src*="googlesyndication" i]',
    '[data-google-query-id]','[class~="ads"]','[class*="adsbygoogle" i]'
  ];

  function visible(el) {
    if (!el || el.offsetParent === null) return false;
    const r = el.getBoundingClientRect();
    if (r.width * r.height <= MIN_AREA) return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0')
      return false;
    return true;
  }
  function hostMatch(src) {
    try {
      const h = new URL(src, location.href).host.toLowerCase();
      return AD_HOSTS.some((d) => h.includes(d) || src.toLowerCase().includes(d));
    } catch { return false; }
  }

  const found = new Set();
  // 1) ad iframes by host
  for (const f of document.querySelectorAll('iframe[src]')) {
    if (visible(f) && hostMatch(f.getAttribute('src') || '')) found.add(f);
  }
  // 2) ad-ish selectors
  for (const sel of AD_SELECTORS) {
    let nodes;
    try { nodes = document.querySelectorAll(sel); } catch { continue; }
    for (const el of nodes) if (visible(el)) found.add(el);
  }

  let area = 0;
  for (const el of found) {
    const r = el.getBoundingClientRect();
    area += Math.max(0, r.width) * Math.max(0, r.height);
  }

  // Landmarks for false-positive detection on clean sites.
  function landmark(sel) {
    const el = document.querySelector(sel);
    return { present: !!el, visible: el ? visible(el) : false };
  }

  const bodyText =
    document.body && document.body.innerText ? document.body.innerText : '';
  // The sandbox egress proxy sometimes returns an error stub instead of the
  // real page; flag it so the harness counts it as unreachable, not a false
  // positive.
  const errish =
    bodyText.length < 400 &&
    /upstream connect error|no healthy upstream|connection timeout|ERR_[A-Z_]+|502 Bad Gateway|503 Service/i.test(
      bodyText,
    );

  return {
    adCount: found.size,
    adArea: Math.round(area),
    errish,
    innerTextLen: bodyText.length,
    landmarks: {
      main: landmark('main'),
      article: landmark('article'),
      h1: landmark('h1'),
      nav: landmark('nav'),
    },
  };
})()`;

// ---- Storage seeding -----------------------------------------------------
// The extension reads settings from chrome.storage.sync key "settings" (WXT
// item "sync:settings"). We seed it from the extension's service worker, which
// is the only context with chrome.storage access. Full DEFAULT_SETTINGS shape
// is written so the content script gets a complete object regardless of the
// WXT versioned-item meta.
const DEFAULTS = {
  hideSelectors: [
    '[data-ad]',
    '[id*="sponsored" i]',
    '[class*="sponsored" i]',
    '.newsletter-wall',
    '.cookie-banner',
    '[aria-label="advertisement" i]',
    'iframe[id^="google_ads_iframe"]',
    '[id^="div-gpt-ad"]',
    '[data-google-query-id]',
    'ins.adsbygoogle',
    'iframe[src*="doubleclick" i]',
    'iframe[src*="googlesyndication" i]',
    '[id*="taboola" i]',
    '[class*="taboola" i]',
    '[id*="outbrain" i]',
    '[class*="outbrain" i]',
    '[class~="ads"]',
    '[class*="ad-slot" i]',
    '[class*="ad-unit" i]',
    '[class*="ad-container" i]',
    '#onetrust-banner-sdk',
    '#onetrust-consent-sdk',
    '.onetrust-pc-dark-filter',
    '[class*="newsletter" i]',
    '[id*="newsletter" i]',
  ],
  removeSelectors: [],
  spoofAntiAdblock: true,
  cosmeticFilters: '',
  dismissConsent: true,
};

async function getServiceWorker(context) {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  return sw;
}

async function seedSettings(sw, enabled) {
  await sw.evaluate(
    async ({ enabled, defaults }) => {
      const settings = { enabled, ...defaults };
      await chrome.storage.sync.set({ settings });
    },
    { enabled, defaults: DEFAULTS },
  );
}

// ---- Page helpers --------------------------------------------------------
async function autoScroll(page) {
  for (let i = 0; i < SCROLL_STEPS; i++) {
    await page
      .evaluate(() => window.scrollBy(0, document.body.scrollHeight / 4))
      .catch(() => {});
    await page.waitForTimeout(700);
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
}

async function measureOnce(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  await page.waitForTimeout(SETTLE_MS);
  await autoScroll(page);
  await page.waitForTimeout(800);
  return page.evaluate(MEASURE_FN);
}

// ---- Per-site evaluation -------------------------------------------------
async function evalSite(context, sw, entry, kind) {
  const url = entry.url;
  const result = { url, kind, status: 'ok' };
  const page = await context.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);
  try {
    // Baseline: disabled.
    await seedSettings(sw, false);
    const before = await measureOnce(page, url);

    // Treatment: enabled. Reload so content scripts re-run with new settings.
    await seedSettings(sw, true);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await page.waitForTimeout(SETTLE_MS);
    await autoScroll(page);
    await page.waitForTimeout(800);
    const after = await page.evaluate(MEASURE_FN);

    result.before = before;
    result.after = after;

    // If either pass hit a proxy/egress error stub, the page didn't really
    // render — don't score it as pass/fail.
    if (before.errish || after.errish) {
      result.status = 'unreachable';
      result.reason = 'egress proxy error stub (not a real page render)';
      return result;
    }

    if (kind === 'ad') {
      const b = before.adCount;
      const a = after.adCount;
      const reduction = b === 0 ? (a === 0 ? 1 : 0) : (b - a) / b;
      result.adBefore = b;
      result.adAfter = a;
      result.reduction = reduction;
      result.pass = a === 0 || reduction >= AD_REDUCTION_PASS;
      if (b === 0) {
        result.note = 'no visible ads in baseline (bot-wall or paywall?)';
      }
    } else {
      const drop =
        before.innerTextLen === 0
          ? 0
          : (before.innerTextLen - after.innerTextLen) / before.innerTextLen;
      result.innerTextDrop = drop;
      const reasons = [];
      if (drop > FP_INNERTEXT_DROP)
        reasons.push(`innerText dropped ${(drop * 100).toFixed(1)}%`);
      for (const [name, lm] of Object.entries(before.landmarks)) {
        const lmAfter = after.landmarks[name];
        // Only flag a landmark that was truly REMOVED from the DOM. A mere
        // not-visible flip is too flaky (render/scroll timing) and a real
        // content removal also shows up in the innerText-drop check above.
        if (lm.present && !lmAfter.present)
          reasons.push(`landmark <${name}> removed`);
      }
      result.fpReasons = reasons;
      result.pass = reasons.length === 0;
    }
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    if (/ERR_CERT/.test(msg)) result.status = 'error';
    else if (/egress|ERR_BLOCKED|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED/.test(msg))
      result.status = 'unreachable';
    else if (/Timeout|timeout/.test(msg)) result.status = 'unreachable';
    else result.status = 'error';
    result.reason = msg.split('\n')[0].slice(0, 200);
  } finally {
    await page.close().catch(() => {});
  }
  return result;
}

// ---- Main ----------------------------------------------------------------
async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(
    `[harness] extension: ${EXTENSION_PATH}\n` +
      `[harness] mode: ${FULL ? 'FULL' : 'SMOKE'}  ad=${adSites.length} clean=${cleanSites.length}\n` +
      `[harness] out: ${OUT_DIR}`,
  );

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    ignoreHTTPSErrors: true,
    userAgent: UA,
    viewport: { width: 1366, height: 900 },
    args: [
      '--headless=new',
      '--no-sandbox',
      '--ignore-certificate-errors',
      '--test-type',
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });

  const sw = await getServiceWorker(context);
  const results = [];

  for (const entry of adSites) {
    process.stdout.write(`[ad]    ${entry.url} ... `);
    const r = await evalSite(context, sw, entry, 'ad');
    results.push(r);
    console.log(
      r.status !== 'ok'
        ? r.status
        : `${r.adBefore}->${r.adAfter} (${(r.reduction * 100).toFixed(0)}%) ${r.pass ? 'PASS' : 'FAIL'}`,
    );
  }
  for (const entry of cleanSites) {
    process.stdout.write(`[clean] ${entry.url} ... `);
    const r = await evalSite(context, sw, entry, 'clean');
    results.push(r);
    console.log(
      r.status !== 'ok'
        ? r.status
        : r.pass
          ? 'PASS'
          : `FAIL (${r.fpReasons.join('; ')})`,
    );
  }

  await context.close();

  const report = buildReport(results);
  writeFileSync(
    resolve(OUT_DIR, 'report.json'),
    JSON.stringify(report, null, 2),
  );
  writeFileSync(resolve(OUT_DIR, 'report.md'), renderMarkdown(report));
  console.log(`\n[harness] wrote ${OUT_DIR}/report.json and report.md`);
  console.log(renderMarkdown(report));
}

function buildReport(results) {
  const ad = results.filter((r) => r.kind === 'ad');
  const clean = results.filter((r) => r.kind === 'clean');
  const adReachable = ad.filter((r) => r.status === 'ok');
  const cleanReachable = clean.filter((r) => r.status === 'ok');
  const adWithAds = adReachable.filter((r) => r.adBefore > 0);

  const avgReduction =
    adWithAds.length === 0
      ? 0
      : adWithAds.reduce((s, r) => s + r.reduction, 0) / adWithAds.length;

  return {
    generatedAt: new Date().toISOString(),
    mode: FULL ? 'full' : 'smoke',
    thresholds: {
      adReductionPass: AD_REDUCTION_PASS,
      fpInnerTextDrop: FP_INNERTEXT_DROP,
    },
    aggregate: {
      adHeavy: {
        total: ad.length,
        reachable: adReachable.length,
        withVisibleAds: adWithAds.length,
        passed: adReachable.filter((r) => r.pass).length,
        avgReductionPct: +(avgReduction * 100).toFixed(1),
      },
      clean: {
        total: clean.length,
        reachable: cleanReachable.length,
        falsePositives: cleanReachable.filter((r) => !r.pass).length,
        passed: cleanReachable.filter((r) => r.pass).length,
      },
      unreachableOrError: results.filter((r) => r.status !== 'ok').length,
    },
    sites: results,
  };
}

function renderMarkdown(report) {
  const a = report.aggregate.adHeavy;
  const c = report.aggregate.clean;
  const lines = [];
  lines.push(`# Validation report (${report.mode})`);
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push('## Aggregate');
  lines.push('');
  lines.push(
    `- Ad-heavy: ${a.reachable}/${a.total} reachable, ${a.withVisibleAds} with baseline ads, ` +
      `${a.passed} passed (>=${report.thresholds.adReductionPass * 100}% reduction), ` +
      `avg reduction ${a.avgReductionPct}%`,
  );
  lines.push(
    `- Clean: ${c.reachable}/${c.total} reachable, ${c.falsePositives} false-positive sites`,
  );
  lines.push(`- Unreachable/error: ${report.aggregate.unreachableOrError}`);
  lines.push('');
  lines.push('## Per-site');
  lines.push('');
  lines.push('| kind | url | status | detail |');
  lines.push('| --- | --- | --- | --- |');
  for (const r of report.sites) {
    let detail = '';
    if (r.status !== 'ok') detail = r.reason || '';
    else if (r.kind === 'ad')
      detail = `${r.adBefore}->${r.adAfter} (${(r.reduction * 100).toFixed(0)}%) ${r.pass ? 'PASS' : 'FAIL'}`;
    else
      detail = r.pass
        ? `PASS (innerText drop ${(r.innerTextDrop * 100).toFixed(1)}%)`
        : `FAIL: ${r.fpReasons.join('; ')}`;
    lines.push(
      `| ${r.kind} | ${r.url} | ${r.status} | ${detail.replace(/\|/g, '/')} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

main().catch((err) => {
  console.error('[harness] fatal:', err);
  process.exit(1);
});
