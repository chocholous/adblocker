import { defineContentScript } from 'wxt/sandbox';

/**
 * MAIN-world content script — the optional "stealth" layer.
 *
 * Runs in the page's own JS context so it can patch page-visible globals before
 * site scripts read them. This neutralizes common anti-adblock bait checks
 * (e.g. sniffing `window.adsbygoogle`). It has NO access to chrome.* APIs, so it
 * receives its config from the ISOLATED script via a CustomEvent.
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

    window.addEventListener('sch:config', (event) => {
      const detail = (event as CustomEvent).detail;
      if (detail && typeof detail.spoofAntiAdblock === 'boolean') {
        spoof = detail.spoofAntiAdblock;
      }
    });

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
