import {
  settingsItem,
  apiKeyItem,
  serializeSettings,
  parseSettings,
  type HiderSettings,
} from '@/lib/settings';
import { browser } from 'wxt/browser';
import type { CleanupResult, DetectedRule } from '@/lib/detect';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

const enabled = $<HTMLInputElement>('enabled');
const hideSelectors = $<HTMLTextAreaElement>('hideSelectors');
const removeSelectors = $<HTMLTextAreaElement>('removeSelectors');
const cosmeticFilters = $<HTMLTextAreaElement>('cosmeticFilters');
const spoofAntiAdblock = $<HTMLInputElement>('spoofAntiAdblock');
const status = $<HTMLSpanElement>('status');

const exportBtn = $<HTMLButtonElement>('export');
const importBtn = $<HTMLButtonElement>('import');
const ioText = $<HTMLTextAreaElement>('ioText');
const ioStatus = $<HTMLSpanElement>('ioStatus');

const apiKey = $<HTMLInputElement>('apiKey');
const cleanup = $<HTMLButtonElement>('cleanup');
const aiStatus = $<HTMLSpanElement>('aiStatus');
const results = $<HTMLDivElement>('results');
const resultsActions = $<HTMLDivElement>('resultsActions');
const saveRules = $<HTMLButtonElement>('saveRules');
const clearPreviewBtn = $<HTMLButtonElement>('clearPreview');

const linesToList = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

/* ---------- core settings ---------- */

async function load(): Promise<void> {
  const s = await settingsItem.getValue();
  enabled.checked = s.enabled;
  hideSelectors.value = s.hideSelectors.join('\n');
  removeSelectors.value = s.removeSelectors.join('\n');
  cosmeticFilters.value = s.cosmeticFilters;
  spoofAntiAdblock.checked = s.spoofAntiAdblock;
  apiKey.value = await apiKeyItem.getValue();
}

async function save(): Promise<void> {
  const next: HiderSettings = {
    enabled: enabled.checked,
    hideSelectors: linesToList(hideSelectors.value),
    removeSelectors: linesToList(removeSelectors.value),
    // Cosmetic filters keep their raw text verbatim (one rule per line);
    // trimming/blank-line removal happens at parse time, not on save.
    cosmeticFilters: cosmeticFilters.value,
    spoofAntiAdblock: spoofAntiAdblock.checked,
  };
  await settingsItem.setValue(next);
  status.textContent = 'Saved';
  setTimeout(() => (status.textContent = ''), 1500);
}

$('save').addEventListener('click', () => void save());
apiKey.addEventListener(
  'change',
  () => void apiKeyItem.setValue(apiKey.value.trim()),
);

/* ---------- import / export ---------- */

/**
 * Export the full current settings as JSON into the I/O textarea and copy it to
 * the clipboard when available. Reads from storage (not the form) so an export
 * reflects the persisted state, making the round-trip authoritative.
 */
async function exportSettings(): Promise<void> {
  const json = serializeSettings(await settingsItem.getValue());
  ioText.value = json;
  try {
    await navigator.clipboard.writeText(json);
    ioStatus.textContent = 'Exported (copied to clipboard).';
  } catch {
    ioStatus.textContent = 'Exported.';
  }
}

/**
 * Import settings from the I/O textarea: validate, persist via
 * `settingsItem.setValue`, then reload the form so the new values are visible.
 * The write is lossless — `cosmeticFilters` and every other field round-trip.
 */
async function importSettings(): Promise<void> {
  try {
    const next = parseSettings(ioText.value);
    await settingsItem.setValue(next);
    await load();
    ioStatus.textContent = 'Imported.';
  } catch (err) {
    ioStatus.textContent = `Import failed: ${
      err instanceof Error ? err.message : 'invalid input'
    }`;
  }
}

exportBtn.addEventListener('click', () => void exportSettings());
importBtn.addEventListener('click', () => void importSettings());

/* ---------- AI cleanup ---------- */

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function renderRules(rules: DetectedRule[]): void {
  results.replaceChildren();
  if (rules.length === 0) {
    resultsActions.hidden = true;
    aiStatus.textContent = 'Nothing to clean up.';
    return;
  }
  for (const rule of rules) {
    const row = document.createElement('label');
    row.className = 'result';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = true;
    box.dataset.selector = rule.selector;
    const text = document.createElement('span');
    text.innerHTML = `<strong>${rule.category}</strong> ${rule.label}`;
    text.title = rule.selector;
    row.append(box, text);
    results.appendChild(row);
  }
  resultsActions.hidden = false;
}

async function runCleanup(): Promise<void> {
  const tabId = await activeTabId();
  if (tabId == null) {
    aiStatus.textContent = 'No active tab.';
    return;
  }
  cleanup.disabled = true;
  aiStatus.textContent = 'Analyzing page…';
  try {
    const res = (await browser.tabs.sendMessage(tabId, {
      type: 'sch:cleanup',
    })) as CleanupResult;
    if (!res.ok) {
      aiStatus.textContent = res.error;
      return;
    }
    aiStatus.textContent = `Found ${res.rules.length} — previewing.`;
    renderRules(res.rules);
  } catch {
    aiStatus.textContent = 'This page can’t be cleaned up (no content script).';
  } finally {
    cleanup.disabled = false;
  }
}

async function saveSelectedRules(): Promise<void> {
  const selected = Array.from(
    results.querySelectorAll<HTMLInputElement>('input:checked'),
  )
    .map((box) => box.dataset.selector)
    .filter((s): s is string => !!s);

  const current = await settingsItem.getValue();
  const merged = Array.from(new Set([...current.hideSelectors, ...selected]));
  await settingsItem.setValue({ ...current, hideSelectors: merged });
  hideSelectors.value = merged.join('\n');
  aiStatus.textContent = `Saved ${selected.length} rule(s).`;
}

async function clearPreview(): Promise<void> {
  const tabId = await activeTabId();
  if (tabId != null) {
    await browser.tabs.sendMessage(tabId, { type: 'sch:clearPreview' });
  }
  results.replaceChildren();
  resultsActions.hidden = true;
  aiStatus.textContent = '';
}

cleanup.addEventListener('click', () => void runCleanup());
saveRules.addEventListener('click', () => void saveSelectedRules());
clearPreviewBtn.addEventListener('click', () => void clearPreview());

void load();
