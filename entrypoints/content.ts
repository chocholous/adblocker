import { defineContentScript } from 'wxt/sandbox';
import { browser } from 'wxt/browser';
import { settingsItem } from '@/lib/settings';
import { createHider } from '@/lib/hider';
import { buildPageDigest } from '@/lib/digest';
import type {
  CleanupResult,
  DetectResponse,
  RuntimeMessage,
} from '@/lib/detect';
import '@/assets/hider.css';

const PREVIEW_STYLE_ID = 'sch-preview-style';

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
    const settings = await settingsItem.getValue();

    window.dispatchEvent(
      new CustomEvent('sch:config', {
        detail: { spoofAntiAdblock: settings.spoofAntiAdblock },
      }),
    );

    if (settings.enabled) {
      const hider = createHider(settings);
      hider.injectStyles();
      hider.startObserver();
      settingsItem.watch((next) => hider.update(next));
    }

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
