// Deterministic, offline-capable filter-engine builder.
//
// Downloads the canonical ad/tracking filter lists (EasyList, EasyPrivacy,
// uBlock Origin filters, AdGuard Base), builds a `@ghostery/adblocker`
// `FiltersEngine`, serializes it to a Uint8Array, and writes the bytes to
// `public/filter-engine.bin` — a bundled extension asset the content script
// loads at runtime via `FiltersEngine.deserialize`.
//
// Offline / CI-without-network fallback: if every download fails, the engine is
// built from the small checked-in `lib/fallback-filters.txt` so `npm run build`
// stays green and reproducible everywhere. The committed `public/filter-engine.bin`
// is itself a real-list build, so a fresh checkout already ships a full engine
// even before this script runs.
//
// Run: node scripts/build-filters.mjs   (wired via `npm run build:filters`)

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FiltersEngine } from '@ghostery/adblocker';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_FILE = join(ROOT, 'public', 'filter-engine.bin');
const FALLBACK_FILE = join(ROOT, 'lib', 'fallback-filters.txt');

// Canonical lists. EasyList + EasyPrivacy are the non-negotiable minimum; the
// uBO and AdGuard base lists broaden coverage. Order is irrelevant to the engine.
const LISTS = [
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist.to/easylist/easyprivacy.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/badware.txt',
  'https://filters.adtidy.org/extension/ublock/filters/2_without_easylist.txt',
  // Regional: EasyList Czech & Slovak — covers Sklik/Seznam/iDNES/Novinky ads.
  'https://raw.githubusercontent.com/tomasko126/easylistczechandslovak/master/filters.txt',
  // Annoyances / cookie-consent / overlays (candidates — kept only while the
  // full clean corpus stays at zero false-positives; see validation/run.mjs).
  'https://filters.adtidy.org/extension/ublock/filters/18_optimized.txt', // AdGuard Cookie Notices
  'https://filters.adtidy.org/extension/ublock/filters/19_optimized.txt', // AdGuard Popups
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/annoyances-cookies.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/annoyances-overlays.txt',
];

// Engine config. We enable the features the content runtime relies on:
//  - cosmetic + network filtering (defaults on)
//  - generic cosmetic filters (resolved against the live DOM at runtime)
//  - compression to keep the serialized blob small
const ENGINE_CONFIG = {
  enableCompression: true,
  loadCosmeticFilters: true,
  loadNetworkFilters: true,
  loadGenericCosmeticsFilters: true,
};

async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function downloadLists() {
  const results = await Promise.allSettled(LISTS.map(fetchText));
  const lists = [];
  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    if (r.status === 'fulfilled' && r.value.trim().length > 0) {
      lists.push(r.value);
      console.log(`  ✓ ${LISTS[i]} (${r.value.length} bytes)`);
    } else {
      const reason = r.status === 'rejected' ? r.reason : 'empty';
      console.warn(`  ✗ ${LISTS[i]} — ${reason}`);
    }
  }
  return lists;
}

async function main() {
  mkdirSync(dirname(OUT_FILE), { recursive: true });

  console.log('Downloading filter lists…');
  let lists = [];
  try {
    lists = await downloadLists();
  } catch (err) {
    console.warn('Download phase failed wholesale:', err);
  }

  let source;
  if (lists.length === 0) {
    console.warn(
      'No lists downloaded (offline?). Falling back to lib/fallback-filters.txt.',
    );
    source = readFileSync(FALLBACK_FILE, 'utf8');
  } else {
    // Always fold in the fallback list too so our curated edge-case rules ship
    // regardless of upstream list contents.
    source = [readFileSync(FALLBACK_FILE, 'utf8'), ...lists].join('\n');
  }

  console.log('Building FiltersEngine…');
  const engine = FiltersEngine.parse(source, ENGINE_CONFIG);
  const serialized = engine.serialize();

  writeFileSync(OUT_FILE, serialized);
  const kb = (serialized.length / 1024).toFixed(1);
  console.log(`Wrote ${OUT_FILE} (${kb} KiB, ${lists.length} remote lists).`);
}

main().catch((err) => {
  console.error('build-filters failed:', err);
  process.exit(1);
});
