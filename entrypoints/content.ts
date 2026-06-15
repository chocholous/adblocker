import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { settingsItem, type HiderSettings } from '@/lib/settings';
import { createHider, type ResolvedCosmetics } from '@/lib/hider';
import { parseCosmeticFilters, selectorsForHostname } from '@/lib/filterlist';
import { collectDomHints } from '@/lib/dom-hints';
import { buildPageDigest } from '@/lib/digest';
import { serveSpoofConfig } from '@/lib/bridge';
import { runConsentHandler } from '@/lib/consent';
import { runHidePass, type CollectedResource } from '@/lib/net-hide';
import { startPicker } from '@/lib/picker';
import type {
  CleanupResult,
  DetectResponse,
  EngineCosmeticsResponse,
  MatchResourcesResponse,
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

/**
 * Ask the background filter engine for the cosmetics that apply to this frame,
 * passing the page's DOM tokens so generic hides can be resolved. Returns an
 * empty result on any failure so a missing/broken engine never breaks the page.
 */
async function fetchEngineCosmetics(): Promise<EngineCosmeticsResponse> {
  try {
    const hints = collectDomHints(document);
    const res = (await browser.runtime.sendMessage({
      type: 'sch:engineCosmetics',
      url: location.href,
      hostname: location.hostname,
      domain: null,
      hints,
    })) as EngineCosmeticsResponse | undefined;
    return res ?? { styles: '', scripts: [] };
  } catch {
    return { styles: '', scripts: [] };
  }
}

/**
 * Ask the background engine which of a batch of resources match an ad/tracker
 * NETWORK filter. Returns the matched indices (into `items`). Defensive: any
 * failure (no engine, disabled, messaging error) yields an empty match set so
 * the hide pass simply hides nothing rather than breaking the page.
 */
async function matchResources(items: CollectedResource[]): Promise<number[]> {
  try {
    const res = (await browser.runtime.sendMessage({
      type: 'sch:matchResources',
      sourceUrl: location.href,
      items: items.map((item, id) => ({ id, url: item.url, type: item.type })),
    })) as MatchResourcesResponse | undefined;
    return res?.matched ?? [];
  } catch {
    return [];
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

    // Consent / cookie (CMP) wall handling. Runs only in the top frame (CMPs
    // wall the main document, not sub-frames) and only when both the master
    // switch and the dismissConsent toggle are on. Fully defensive internally,
    // so a misbehaving page can never break the rest of the content script.
    if (settings.enabled && settings.dismissConsent && window.top === window) {
      try {
        runConsentHandler();
      } catch {
        // never let consent handling abort the rest of setup
      }
    }

    // Pull the real-list engine cosmetics for this frame and layer them on top
    // of the synchronous default/user stylesheet. This is the "ads disappear at
    // scale" layer: EasyList/EasyPrivacy/uBO/AdGuard hides, including generic
    // ones resolved against the live DOM. Runs async (engine lives in the
    // background) so it never blocks the document_start default injection. We
    // re-resolve a few times as the DOM grows, since generic hides depend on the
    // classes/ids/hrefs actually present on the page.
    let lastEngineStyles = '';
    const refreshEngineCosmetics = async (): Promise<void> => {
      if (!hider) return;
      const { styles } = await fetchEngineCosmetics();
      if (styles && styles !== lastEngineStyles) {
        lastEngineStyles = styles;
        hider.setEngineStyles(styles);
      }
    };
    void refreshEngineCosmetics();
    // Debounced re-resolution while the DOM is still being built up.
    let engineTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleEngineRefresh = (): void => {
      if (engineTimer) return;
      engineTimer = setTimeout(() => {
        engineTimer = null;
        void refreshEngineCosmetics();
      }, 500);
    };
    const engineObserver = new MutationObserver(() => {
      if (settings.enabled) scheduleEngineRefresh();
    });
    try {
      engineObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    } catch {
      // documentElement should always exist at document_start; ignore if not.
    }
    // Stop re-resolving once the page has settled to bound work.
    setTimeout(() => engineObserver.disconnect(), 10000);

    // Network-rules-as-cosmetic: HIDE (never block) elements whose resource URL
    // matches one of the engine's NETWORK filters (||doubleclick.net^, …). The
    // request still loads — we just hide the element afterwards, so the server
    // sees normal traffic (stealth). Verdicts are cached per-URL; the pass is
    // idempotent and fully defensive (see lib/net-hide.ts). Ads load late, so we
    // re-run on DOM mutations (debounced ~400ms) within a bounded window.
    const netVerdictCache = new Map<string, boolean>();
    const runNetHidePass = async (): Promise<void> => {
      if (!settings.enabled) return;
      try {
        await runHidePass(
          document,
          location.href,
          matchResources,
          netVerdictCache,
        );
      } catch {
        // runHidePass is already fully guarded; this is a final belt-and-braces.
      }
    };
    void runNetHidePass();
    let netTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleNetHidePass = (): void => {
      if (netTimer) return;
      netTimer = setTimeout(() => {
        netTimer = null;
        void runNetHidePass();
      }, 400);
    };
    const netObserver = new MutationObserver(() => {
      if (settings.enabled) scheduleNetHidePass();
    });
    try {
      netObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'data'],
      });
    } catch {
      // documentElement should always exist at document_start; ignore if not.
    }
    // Ads can load late, but bound the work: stop observing after 15s.
    setTimeout(() => netObserver.disconnect(), 15000);

    // Keep `settings` current so the spoof config served to MAIN reflects live
    // changes, and propagate updates to the hider when active.
    settingsItem.watch((next: HiderSettings) => {
      settings = next;
      // Re-resolve per-hostname cosmetics (the raw text may have changed), then
      // push the new settings snapshot to the hider.
      hider?.setCosmetics(resolveCosmetics(next));
      hider?.update(next);
      void refreshEngineCosmetics();
      void runNetHidePass();
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
      // Element picker: top frame only (the user interacts with the main
      // document). Fully guarded inside startPicker so it can never break the
      // page.
      if (msg?.type === 'sch:startPicker' && window.top === window) {
        startPicker();
        return Promise.resolve({ ok: true });
      }
      return undefined;
    });
  },
});
