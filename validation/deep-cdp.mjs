#!/usr/bin/env node
// @ts-nocheck
/**
 * Deep, parallel, CDP-driven field test for the Stealth Content Hider.
 *
 * Unlike validation/run.mjs (which launches its own headless Chromium and toggles
 * the master switch for a baseline/treatment diff), this driver connects over CDP
 * to a REAL browser that already has the extension installed and ENABLED — the
 * user's laptop, shared via scripts/cdp-share. It does a *deep* per-site check:
 *
 *   landing -> scroll to bottom -> open up to N in-domain articles -> scroll each
 *
 * and at every step gathers EVIDENCE aimed at improving the adblocker:
 *   - CRITICAL false-positives: blank / near-blank pages (we blanked real content)
 *   - false-positives: big innerText loss, removed main/article landmark
 *   - GAPS: ad iframes/slots still VISIBLE (by host + selector) -> filter ideas
 *   - CONSENT: consent/cookie walls still visible (by selector) -> handler ideas
 *   - redirects to dedicated consent domains (cmp.seznam.cz, …)
 *   - page console/JS errors
 *
 * PARALLELISM + QUEUE: a fixed pool of `--concurrency` workers drains a shared
 * queue of targets, each worker driving its OWN tab inside the single CDP browser.
 *
 * Connect endpoint comes from $CDP_ENDPOINT (see scripts/cdp-share/endpoints.local.env):
 *   set -a; . scripts/cdp-share/endpoints.local.env; set +a
 *   node validation/deep-cdp.mjs --set=cz --concurrency=3 --articles=2
 *
 * Flags:
 *   --set=cz|intl|clean|all   target group (default cz)
 *   --concurrency=N           parallel tabs (default 3)
 *   --articles=N              articles to open per site (default 2)
 *   --limit=N                 cap number of sites
 *   --out=DIR                 report/screenshot dir (default /tmp/sch-deep)
 *   --shots                   also save full-page screenshots (evidence)
 *
 * Artifacts (NOT committed): <out>/report.json, <out>/report.md, <out>/shots/*.
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));

// ---- CLI -----------------------------------------------------------------
const args = process.argv.slice(2);
const val = (k, d) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split('=')[1] : d;
};
const SET = val('set', 'cz');
const CONCURRENCY = Math.max(1, parseInt(val('concurrency', '3'), 10));
const ARTICLES = Math.max(0, parseInt(val('articles', '2'), 10));
const LIMIT = parseInt(val('limit', '0'), 10) || 0;
const OUT_DIR = val('out', '/tmp/sch-deep');
const SHOTS = args.includes('--shots');
const URLS_FILE = val('urlsfile', '');
const NAV_TIMEOUT = parseInt(val('navtimeout', '30000'), 10) || 30000;
const KIND_DEFAULT = val('kind', 'ad');

const CDP = process.env.CDP_ENDPOINT;
if (!CDP) {
  console.error(
    'CDP_ENDPOINT not set. Run: set -a; . scripts/cdp-share/endpoints.local.env; set +a',
  );
  process.exit(2);
}

// ---- Targets -------------------------------------------------------------
// CZ ad-heavy properties the user cares about + a clutch of clean CZ sites to
// guard the zero-false-positive promise. International + clean reuse the corpus.
const CZ = [
  { url: 'https://www.idnes.cz/', kind: 'ad' },
  { url: 'https://www.novinky.cz/', kind: 'ad' },
  { url: 'https://www.sport.cz/', kind: 'ad' },
  { url: 'https://www.seznamzpravy.cz/', kind: 'ad' },
  { url: 'https://www.blesk.cz/', kind: 'ad' },
  { url: 'https://www.reflex.cz/', kind: 'ad' },
  { url: 'https://www.aktualne.cz/', kind: 'ad' },
  { url: 'https://www.denik.cz/', kind: 'ad' },
  { url: 'https://www.lidovky.cz/', kind: 'ad' },
  { url: 'https://www.e15.cz/', kind: 'ad' },
  { url: 'https://www.super.cz/', kind: 'ad' },
  { url: 'https://www.expres.cz/', kind: 'ad' },
  // clean CZ references (must NOT lose content / go blank)
  { url: 'https://cs.wikipedia.org/wiki/Praha', kind: 'clean' },
  { url: 'https://www.mojedatovaschranka.cz/', kind: 'clean' },
];

const corpusJson = JSON.parse(readFileSync(resolve(here, 'corpus.json'), 'utf8'));

function targets() {
  // Explicit URL list (e.g. re-running a previous run's timed-out sites).
  if (URLS_FILE) {
    const urls = readFileSync(URLS_FILE, 'utf8')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const cleanSet = new Set(corpusJson.clean.map((e) => e.url));
    const list = urls.map((url) => ({
      url,
      kind: cleanSet.has(url) ? 'clean' : KIND_DEFAULT,
    }));
    return LIMIT ? list.slice(0, LIMIT) : list;
  }
  let list;
  if (SET === 'cz') list = CZ;
  else if (SET === 'intl')
    list = corpusJson.adHeavy.map((e) => ({ url: e.url, kind: 'ad' }));
  else if (SET === 'clean')
    list = corpusJson.clean.map((e) => ({ url: e.url, kind: 'clean' }));
  else
    list = [
      ...CZ,
      ...corpusJson.adHeavy.map((e) => ({ url: e.url, kind: 'ad' })),
      ...corpusJson.clean.map((e) => ({ url: e.url, kind: 'clean' })),
    ];
  return LIMIT ? list.slice(0, LIMIT) : list;
}

// ---- In-page measurement (string IIFE for page.evaluate) -----------------
const MEASURE_FN = `(() => {
  const MIN_AREA = 1500;
  const AD_HOSTS = [
    'doubleclick.net','googlesyndication.com','google_ads','adnxs.com','adsystem',
    'taboola.com','outbrain.com','amazon-adsystem.com','criteo','pubmatic',
    'rubiconproject','adsafeprotected','2mdn','moatads','adservice.google',
    'casalemedia','smartadserver','adform','teads','sharethrough','indexww',
    'openx','yieldmo','3lift','adroll','mgid','revcontent','zergnet',
    'imedia.cz','seznam.cz/rc','ssp.imedia','cpex','onlajny','sklik','imimg',
    'cncenter','etarget','r.seznam.cz','c.imedia.cz'
  ];
  const AD_SELECTORS = [
    '[id*="google_ads"]','[id^="div-gpt-ad"]','ins.adsbygoogle',
    '[class*="ad-slot" i]','[class*="ad-unit" i]','[class*="ad-container" i]',
    '[aria-label*="advert" i]','[id*="taboola" i]','[class*="taboola" i]',
    '[id*="outbrain" i]','[class*="outbrain" i]','iframe[id^="google_ads_iframe"]',
    'iframe[src*="doubleclick" i]','iframe[src*="googlesyndication" i]',
    '[data-google-query-id]','[class~="ads"]','[class*="adsbygoogle" i]',
    '[class*="ssp-advert" i]','[class*="inzerce" i]','[id*="sklik" i]'
  ];
  const CONSENT_SELECTORS = [
    '#onetrust-banner-sdk','.szn-cmp-dialog-container','[id*="cmp" i]',
    '[class*="cookie" i]','[class*="consent" i]','[id*="cpex" i]',
    '[class*="didomi" i]','#CybotCookiebotDialog','[class*="cmp" i]'
  ];
  function vis(el) {
    if (!el || el.offsetParent === null) {
      const s0 = getComputedStyle(el);
      if (s0.position !== 'fixed' && s0.position !== 'sticky') return false;
    }
    const r = el.getBoundingClientRect();
    if (r.width * r.height <= MIN_AREA) return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
    return true;
  }
  function host(src){ try { return new URL(src, location.href).host.toLowerCase(); } catch { return ''; } }
  function hostMatch(src){ const h=host(src); const l=(src||'').toLowerCase(); return AD_HOSTS.some(d=>h.includes(d)||l.includes(d)); }
  function desc(el){
    const id = el.id ? '#'+el.id : '';
    const cls = (typeof el.className==='string'&&el.className) ? '.'+el.className.trim().split(/\\s+/).slice(0,3).join('.') : '';
    return (el.tagName.toLowerCase()+id+cls).slice(0,80);
  }

  const adEls = new Set();
  const adHostsSeen = {};
  for (const f of document.querySelectorAll('iframe[src]')) {
    const src = f.getAttribute('src')||'';
    if (vis(f) && hostMatch(src)) { adEls.add(f); const h=host(src); adHostsSeen[h]=(adHostsSeen[h]||0)+1; }
  }
  for (const sel of AD_SELECTORS) {
    let nodes; try { nodes = document.querySelectorAll(sel); } catch { continue; }
    for (const el of nodes) if (vis(el)) adEls.add(el);
  }
  let adArea = 0; const adSamples = [];
  for (const el of adEls) {
    const r = el.getBoundingClientRect();
    adArea += Math.max(0,r.width)*Math.max(0,r.height);
    if (adSamples.length < 12) {
      const ifr = el.querySelector?.('iframe[src]') || (el.tagName==='IFRAME'?el:null);
      adSamples.push({ sel: desc(el), host: ifr?host(ifr.getAttribute('src')||''):'', w: Math.round(r.width), h: Math.round(r.height) });
    }
  }

  const consent = [];
  for (const sel of CONSENT_SELECTORS) {
    let nodes; try { nodes = document.querySelectorAll(sel); } catch { continue; }
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      const shown = s.display!=='none' && s.visibility!=='hidden' && r.width*r.height>2000;
      if (shown) { consent.push(desc(el)); break; }
    }
  }

  function landmark(sel){ const el=document.querySelector(sel); return { present: !!el, visible: el?vis(el):false }; }
  const bodyText = document.body && document.body.innerText ? document.body.innerText : '';
  const txt = bodyText.replace(/\\s+/g,' ').trim();
  const errish = txt.length < 400 && /upstream connect error|no healthy upstream|connection timeout|ERR_[A-Z_]+|502 Bad Gateway|503 Service|tunnel/i.test(txt);

  return {
    url: location.href,
    adCount: adEls.size,
    adArea: Math.round(adArea),
    adSamples,
    adHostsSeen,
    consentVisible: [...new Set(consent)].slice(0,6),
    textLen: txt.length,
    errish,
    landmarks: { main: landmark('main'), article: landmark('article'), h1: landmark('h1'), nav: landmark('nav') },
    title: document.title.slice(0,80),
  };
})()`;

// ---- Page helpers --------------------------------------------------------
async function autoScroll(page, steps = 6) {
  for (let i = 0; i < steps; i++) {
    await page
      .evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 0.9)))
      .catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
}

async function findArticleLinks(page, n) {
  return page
    .evaluate((max) => {
      const origin = location.origin;
      const seen = new Set();
      const out = [];
      const score = (a) => {
        const h = a.getAttribute('href') || '';
        let s = 0;
        if (/\/clanek\/|\/zpravy\/|\/article|\/news\/|-\d{5,}|\/\d{4}\//i.test(h))
          s += 3;
        if ((a.textContent || '').trim().length > 25) s += 1;
        const r = a.getBoundingClientRect();
        if (r.width * r.height > 4000) s += 1;
        return s;
      };
      const links = [...document.querySelectorAll('a[href]')]
        .filter((a) => {
          try {
            const u = new URL(a.href, location.href);
            return u.origin === origin && u.pathname.length > 8;
          } catch {
            return false;
          }
        })
        .map((a) => ({ a, s: score(a) }))
        .filter((x) => x.s >= 3)
        .sort((x, y) => y.s - x.s);
      for (const { a } of links) {
        const href = a.href;
        if (seen.has(href)) continue;
        seen.add(href);
        out.push(href);
        if (out.length >= max) break;
      }
      return out;
    }, n)
    .catch(() => []);
}

const SETTLE = 3000;

async function visit(page, url, label, errors, shotsDir) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  await page.waitForTimeout(SETTLE);
  await autoScroll(page);
  await page.waitForTimeout(800);
  const m = await page.evaluate(MEASURE_FN).catch((e) => ({
    error: String(e.message || e),
  }));
  m.label = label;
  m.requestedUrl = url;
  m.redirected = m.url && !m.url.startsWith(new URL(url).origin);
  m.consoleErrors = errors.splice(0, errors.length);
  // Classify findings.
  m.flags = [];
  if (!m.error) {
    if (m.textLen < 200 && !m.errish) m.flags.push('CRITICAL_BLANK');
    else if (m.textLen < 800 && !m.errish) m.flags.push('LOW_TEXT');
    if (m.landmarks && m.landmarks.article && m.landmarks.article.present === false && /clanek|article|\/\d{4}\//i.test(url) && label !== 'landing') {
      // articles should have an <article> or substantial text
    }
    if (m.adCount > 0) m.flags.push('AD_GAP');
    if (m.consentVisible && m.consentVisible.length) m.flags.push('CONSENT_WALL');
    if (m.redirected && /cmp\.|consent|souhlas/i.test(m.url))
      m.flags.push('CONSENT_REDIRECT');
  } else {
    m.flags.push('NAV_ERROR');
  }
  if (SHOTS && shotsDir) {
    const safe = label.replace(/[^\w.-]/g, '_').slice(0, 60);
    const file = resolve(shotsDir, `${safe}.jpg`);
    await page
      .screenshot({ path: file, type: 'jpeg', quality: 60, fullPage: false })
      .catch(() => {});
    m.shot = file;
  }
  return m;
}

async function processSite(context, site, shotsDir) {
  const out = { url: site.url, kind: site.kind, pages: [] };
  const page = await context.newPage();
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text().slice(0, 200));
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 200)));
  try {
    const landing = await visit(
      page,
      site.url,
      'landing',
      errors,
      shotsDir,
    );
    out.pages.push(landing);

    let links = [];
    if (ARTICLES > 0 && !landing.error) {
      links = await findArticleLinks(page, ARTICLES);
    }
    for (let i = 0; i < links.length; i++) {
      try {
        const art = await visit(
          page,
          links[i],
          `article-${i + 1}`,
          errors,
          shotsDir,
        );
        out.pages.push(art);
      } catch (e) {
        out.pages.push({
          label: `article-${i + 1}`,
          requestedUrl: links[i],
          error: String(e.message || e).slice(0, 200),
          flags: ['NAV_ERROR'],
        });
      }
    }
  } catch (e) {
    out.error = String(e.message || e).slice(0, 200);
  } finally {
    await page.close().catch(() => {});
  }
  // Site-level rollup. A site that produced no pages at all is a navigation
  // failure (usually a timeout under load), NOT a clean pass — label it so.
  out.flags = [...new Set(out.pages.flatMap((p) => p.flags || []))];
  if (out.pages.length === 0 && !out.flags.includes('NAV_ERROR'))
    out.flags.push('NAV_ERROR');
  return out;
}

// ---- Worker-pool queue ---------------------------------------------------
async function runPool(context, sites, shotsDir) {
  const queue = [...sites];
  const results = [];
  let active = 0;
  let idx = 0;
  return new Promise((done) => {
    const pump = () => {
      if (queue.length === 0 && active === 0) return done(results);
      while (active < CONCURRENCY && queue.length) {
        const site = queue.shift();
        const myIdx = ++idx;
        active++;
        const t0 = Date.now();
        process.stdout.write(
          `[start ${myIdx}/${sites.length}] ${site.url}\n`,
        );
        processSite(context, site, shotsDir)
          .then((r) => {
            r.ms = Date.now() - t0;
            results.push(r);
            console.log(
              `[done  ${myIdx}/${sites.length}] ${site.url} :: ${r.flags.join(',') || 'clean'} (${r.pages.length}p, ${r.ms}ms)`,
            );
          })
          .catch((e) => {
            results.push({ url: site.url, kind: site.kind, error: String(e.message || e), flags: ['NAV_ERROR'], pages: [] });
            console.log(`[done  ${myIdx}/${sites.length}] ${site.url} :: ERROR`);
          })
          .finally(() => {
            active--;
            pump();
          });
      }
    };
    pump();
  });
}

// ---- Report --------------------------------------------------------------
function aggregateHosts(results) {
  const hosts = {};
  for (const r of results)
    for (const p of r.pages || [])
      for (const [h, c] of Object.entries(p.adHostsSeen || {}))
        hosts[h] = (hosts[h] || 0) + c;
  return Object.entries(hosts)
    .sort((a, b) => b[1] - a[1])
    .map(([h, c]) => ({ host: h, count: c }));
}

function renderMd(report) {
  const L = [];
  L.push(`# Deep CDP field test (${report.set})`);
  L.push('');
  L.push(`Generated: ${report.generatedAt}`);
  L.push(
    `Sites: ${report.sites.length} · concurrency ${report.concurrency} · articles/site ${report.articles}`,
  );
  L.push('');
  L.push('## Findings by severity');
  L.push('');
  const byFlag = {};
  for (const r of report.results)
    for (const f of r.flags || []) (byFlag[f] ||= []).push(r.url);
  for (const f of [
    'CRITICAL_BLANK',
    'LOW_TEXT',
    'CONSENT_REDIRECT',
    'CONSENT_WALL',
    'AD_GAP',
    'NAV_ERROR',
  ]) {
    const urls = [...new Set(byFlag[f] || [])];
    if (urls.length) L.push(`- **${f}** (${urls.length}): ${urls.join(', ')}`);
  }
  L.push('');
  L.push('## Remaining visible ad hosts (filter-improvement targets)');
  L.push('');
  for (const { host, count } of report.adHosts.slice(0, 30))
    L.push(`- \`${host}\` ×${count}`);
  L.push('');
  L.push('## Per-site detail');
  L.push('');
  for (const r of report.results) {
    L.push(`### ${r.url} _(${r.kind})_ — ${r.flags.join(', ') || 'clean'}`);
    for (const p of r.pages || []) {
      const ads = p.adSamples?.length
        ? ' · ads: ' +
          p.adSamples
            .map((s) => `${s.host || s.sel}(${s.w}×${s.h})`)
            .slice(0, 5)
            .join(', ')
        : '';
      L.push(
        `- **${p.label}** [${(p.flags || []).join(',') || 'ok'}] text=${p.textLen ?? '?'} ads=${p.adCount ?? '?'}${p.consentVisible?.length ? ' consent=' + p.consentVisible.join('|') : ''}${ads}` +
          (p.redirected ? ` → ${p.url}` : '') +
          (p.error ? ` ERR:${p.error}` : ''),
      );
    }
    L.push('');
  }
  return L.join('\n');
}

// ---- Main ----------------------------------------------------------------
async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const shotsDir = SHOTS ? resolve(OUT_DIR, 'shots') : null;
  if (shotsDir) mkdirSync(shotsDir, { recursive: true });

  const sites = targets();
  console.log(
    `[deep] connecting CDP · set=${SET} sites=${sites.length} concurrency=${CONCURRENCY} articles=${ARTICLES}`,
  );
  const browser = await chromium.connectOverCDP(CDP, { timeout: 20000 });
  const context = browser.contexts()[0];

  const results = await runPool(context, sites, shotsDir);
  await browser.close().catch(() => {});

  const report = {
    generatedAt: new Date().toISOString(),
    set: SET,
    concurrency: CONCURRENCY,
    articles: ARTICLES,
    sites,
    results,
    adHosts: aggregateHosts(results),
  };
  writeFileSync(resolve(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(resolve(OUT_DIR, 'report.md'), renderMd(report));
  console.log(`\n[deep] wrote ${OUT_DIR}/report.json and report.md`);
  console.log('\n' + renderMd(report));
}

main().catch((e) => {
  console.error('[deep] fatal:', e);
  process.exit(1);
});
