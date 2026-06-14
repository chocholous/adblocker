import { defineContentScript } from 'wxt/utils/define-content-script';
import { requestSpoofConfig } from '@/lib/bridge';

/**
 * MAIN-world content script — the optional "stealth" layer.
 *
 * Runs in the page's own JS context so it can patch page-visible globals before
 * site scripts read them. This neutralizes common anti-adblock bait checks
 * (e.g. sniffing `window.adsbygoogle`). It has NO access to chrome.* APIs, so it
 * receives its config from the ISOLATED script via a CustomEvent bridge.
 *
 * The handshake is order-independent: this script both listens for the config
 * AND requests it on init, so it cannot miss the dispatch even if the ISOLATED
 * world initialized first. See `lib/bridge.ts`.
 *
 * Keep this self-contained and defensive: a throw here runs inside the page.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  allFrames: true,
  world: 'MAIN',
  main() {
    let spoof = true; // default on until the ISOLATED world says otherwise

    // Listen for the config and request it immediately. Idempotent: each config
    // event simply re-applies the latest value to `spoof`.
    try {
      requestSpoofConfig(window, (config) => {
        spoof = config.spoofAntiAdblock;
      });
    } catch {
      /* never let bridge wiring break the page */
    }

    // Present a benign, "loaded" ad object so bait checks pass while the real
    // elements are hidden cosmetically by the ISOLATED layer.
    try {
      Object.defineProperty(window, 'adsbygoogle', {
        configurable: true,
        get: () => (spoof ? { loaded: true, push: () => {} } : undefined),
        set: () => {},
      });
    } catch {
      /* property already locked by the page; ignore */
    }
  },
});
