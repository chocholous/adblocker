import type { HiderSettings } from './settings';

const STYLE_ID = 'sch-cosmetic-style';

/**
 * Builds the `display: none` stylesheet text for the current hide selectors.
 * Returns an empty string when there is nothing to hide so we never inject a
 * rule like `{ ... }` with an empty prelude.
 */
function buildCss(settings: HiderSettings): string {
  if (!settings.enabled || settings.hideSelectors.length === 0) return '';
  return `${settings.hideSelectors.join(',\n')} {\n  display: none !important;\n}`;
}

/**
 * Joins selectors into a single selector list, or null when empty. Keeping this
 * separate avoids calling querySelectorAll('') which throws.
 */
function selectorList(selectors: string[]): string | null {
  return selectors.length > 0 ? selectors.join(',') : null;
}

/**
 * Cosmetic filter engine for one frame: injects a hide stylesheet and watches
 * the DOM so dynamically-added nodes (SPAs, infinite scroll) are caught too.
 */
export function createHider(initial: HiderSettings) {
  let settings = initial;
  let styleEl: HTMLStyleElement | null = null;
  let observer: MutationObserver | null = null;

  function injectStyles(): void {
    const css = buildCss(settings);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = STYLE_ID;
      // document.head doesn't exist yet at document_start; documentElement does.
      (document.head ?? document.documentElement).appendChild(styleEl);
    }
    styleEl.textContent = css;
  }

  function removeWithin(root: ParentNode): void {
    const list = selectorList(settings.removeSelectors);
    if (!list) return;
    for (const el of root.querySelectorAll(list)) el.remove();
  }

  function startObserver(): void {
    removeWithin(document);
    observer?.disconnect();
    observer = new MutationObserver((mutations) => {
      const list = selectorList(settings.removeSelectors);
      if (!list) return;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const el = node as Element;
          if (el.matches(list)) {
            el.remove();
          } else {
            removeWithin(el);
          }
        }
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  /** Apply a new settings snapshot (e.g. after the popup saves changes). */
  function update(next: HiderSettings): void {
    settings = next;
    if (next.enabled) {
      injectStyles();
      startObserver();
    } else {
      observer?.disconnect();
      observer = null;
      styleEl?.remove();
      styleEl = null;
    }
  }

  return { injectStyles, startObserver, update };
}
