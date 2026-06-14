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

  /**
   * Detach an element, falling back to `display: none` when detaching is not
   * safe. On React/Next SPA pages calling `el.remove()` can throw
   * `Failed to execute 'removeChild' on 'Node'` because the framework still
   * tracks the (now detached) node and tries to reconcile it. Rather than let
   * that crash the page, we hide the element inline so it still disappears
   * without breaking the framework. Hiding is also the degrade path for any
   * other removal failure. Idempotent: a node already hidden/detached is a
   * no-op on re-processing.
   */
  function safeRemove(el: Element): void {
    try {
      el.remove();
    } catch {
      try {
        (el as HTMLElement).style?.setProperty('display', 'none', 'important');
      } catch {
        // Last resort: nothing more we can safely do for this node. Swallow so
        // one pathological node never aborts processing of the rest.
      }
    }
  }

  function removeWithin(root: ParentNode): void {
    const list = selectorList(settings.removeSelectors);
    if (!list) return;
    for (const el of root.querySelectorAll(list)) safeRemove(el);
  }

  function startObserver(): void {
    removeWithin(document);
    observer?.disconnect();
    observer = new MutationObserver((mutations) => {
      try {
        const list = selectorList(settings.removeSelectors);
        if (!list) return;
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            const el = node as Element;
            if (el.matches(list)) {
              safeRemove(el);
            } else {
              removeWithin(el);
            }
          }
        }
      } catch {
        // A single bad node/selector must never kill cosmetic filtering for the
        // rest of the page. Per-node failures are already contained in
        // safeRemove; this is a final guard so the observer callback can never
        // throw out.
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
