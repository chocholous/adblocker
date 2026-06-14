import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { settingsItem, type HiderSettings } from '@/lib/settings';
import { createHider, type ResolvedCosmetics } from '@/lib/hider';
import { parseCosmeticFilters, selectorsForHostname } from '@/lib/filterlist';
import { buildPageDigest } from '@/lib/digest';
import { serveSpoofConfig } from '@/lib/bridge';
import type {
  CleanupResult,
  DetectResponse,
  RuntimeMessage,
} from '@/lib/detect';
import '@/assets/hider.css';

const PREVIEW_STYLE_ID = 'sch-preview-style';

/**
 * Parse the raw cosmetic-filter text and resolve the selectors (plain-CSS and
 * procedural) that apply to the current frame's hostname. Returns empty sets on
 * any failure so a malformed filter list never breaks the page.
 */
function resolveCosmetics(settings: HiderSettings): ResolvedCosmetics {
  try {
    const ruleSet = parseCosmeticFilters(settings.cosmeticFilters);
    return selectorsForHostname(ruleSet, location.hostname);
  } catch {
    return { css: [], procedural: [] };
  }
}

/** Hide a set of selectors as a temporary, unsaved preview. */
function applyPreview(selectors: string[]): void {
  let el = document.getElementById(PREVIEW_STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = PREVIEW_STYLE_ID;
    (document.head ?? document.documentElement).appendChild(el);
  }
  el.textContent = selectors.length
    ? `${selectors.join(',\n')} { display: none !important; }`
    : '';
}

function clearPreview(): void {
  document.getElementById(PREVIEW_STYLE_ID)?.remove();
}

/** Build a digest, ask the background to call Haiku, then preview the result. */
async function runCleanup(): Promise<CleanupResult> {
  const digest = buildPageDigest();
  if (digest.nodes.length === 0) {
    return { ok: false, error: 'No candidate elements found on this page.' };
  }
  const res = (await browser.runtime.sendMessage({
    type: 'sch:detect',
    digest,
  })) as DetectResponse;
  if (res.ok) {
    applyPreview(res.rules.map((r) => r.selector));
  }
  return res;
}

/**
 * ISOLATED-world content script — the primary layer.
 *
 * Applies cosmetic filtering at document_start, and (on demand) orchestrates the
 * AI cleanup flow triggered from the popup.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  allFrames: true,
  cssInjectionMode: 'manifest',
  async main() {
    let settings = await settingsItem.getValue();

    // Serve the spoof config to the MAIN world. This eagerly pushes once and
    // answers any request the MAIN-world script makes, so the handshake works
    // regardless of which script initializes first. `getConfig` reads the latest
    // `settings` so live updates are reflected if MAIN re-requests.
    serveSpoofConfig(window, () => ({
      spoofAntiAdblock: settings.spoofAntiAdblock,
    }));

    const hider = settings.enabled ? createHider(settings) : null;
    if (hider) {
      // Seed per-hostname cosmetic selectors before the first paint passes.
      hider.setCosmetics(resolveCosmetics(settings));
      hider.injectStyles();
      hider.startObserver();
    }
    // Keep `settings` current so the spoof config served to MAIN reflects live
    // changes, and propagate updates to the hider when active.
    settingsItem.watch((next: HiderSettings) => {
      settings = next;
      // Re-resolve per-hostname cosmetics (the raw text may have changed), then
      // push the new settings snapshot to the hider.
      hider?.setCosmetics(resolveCosmetics(next));
      hider?.update(next);
    });

    // Popup-triggered commands. Cleanup runs only in the top frame.
    browser.runtime.onMessage.addListener((message: unknown) => {
      const msg = message as RuntimeMessage | undefined;
      if (msg?.type === 'sch:cleanup' && window.top === window) {
        return runCleanup();
      }
      if (msg?.type === 'sch:clearPreview') {
        clearPreview();
        return Promise.resolve({ ok: true });
      }
      return undefined;
    });
  },
});
