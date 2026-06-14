import type { HiderSettings } from './settings';
import type { ProceduralSelector } from './filterlist';

const STYLE_ID = 'sch-cosmetic-style';

/**
 * Extra cosmetic selectors resolved for the current hostname from the raw
 * `cosmeticFilters` text. These are layered on top of the user's static
 * `hideSelectors`/`removeSelectors`:
 *  - `css`        plain-CSS selectors injected into the hide stylesheet.
 *  - `procedural` selectors (e.g. `:has-text`) the engine evaluates in JS
 *                 because no single CSS selector can express them.
 */
export interface ResolvedCosmetics {
  css: string[];
  procedural: ProceduralSelector[];
}

const EMPTY_COSMETICS: ResolvedCosmetics = { css: [], procedural: [] };

/**
 * Builds the `display: none` stylesheet text for the current hide selectors,
 * including the plain-CSS selectors resolved from the cosmetic-filter text.
 * Returns an empty string when there is nothing to hide so we never inject a
 * rule like `{ ... }` with an empty prelude.
 */
function buildCss(settings: HiderSettings, extraCss: string[]): string {
  if (!settings.enabled) return '';
  const selectors = [...settings.hideSelectors, ...extraCss];
  if (selectors.length === 0) return '';
  return `${selectors.join(',\n')} {\n  display: none !important;\n}`;
}

/**
 * Joins selectors into a single selector list, or null when empty. Keeping this
 * separate avoids calling querySelectorAll('') which throws.
 */
function selectorList(selectors: string[]): string | null {
  return selectors.length > 0 ? selectors.join(',') : null;
}

/**
 * Evaluate a single procedural operation against a candidate element.
 *
 *  - `has-text` (`:has-text()` / `:contains()`): the element's `textContent`
 *    contains `arg`, case-insensitively. This is the canonical thing plain CSS
 *    cannot express — selecting by text content.
 *  - `has` (`:has()`): the element has a descendant matching `arg`. We try
 *    native `el.querySelector(arg)` and treat a thrown (invalid) selector as a
 *    non-match. happy-dom supports `querySelector`, so a JS evaluation keeps the
 *    matcher deterministic in tests regardless of native `:has()` support.
 */
function matchesOperation(
  el: Element,
  op: ProceduralSelector['procedural'][number],
): boolean {
  if (op.type === 'has-text') {
    const text = (el.textContent ?? '').toLowerCase();
    return text.includes(op.arg.toLowerCase());
  }
  // op.type === 'has'
  if (op.arg.length === 0) return false;
  try {
    return el.querySelector(op.arg) !== null;
  } catch {
    return false;
  }
}

/**
 * Cosmetic filter engine for one frame: injects a hide stylesheet, evaluates
 * procedural selectors (which plain CSS cannot express), and watches the DOM so
 * dynamically-added nodes (SPAs, infinite scroll) — and changing text/children
 * on existing nodes — are caught too.
 */
export function createHider(initial: HiderSettings) {
  let settings = initial;
  let cosmetics: ResolvedCosmetics = EMPTY_COSMETICS;
  let styleEl: HTMLStyleElement | null = null;
  let observer: MutationObserver | null = null;

  function injectStyles(): void {
    const css = buildCss(settings, cosmetics.css);
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

  /**
   * Hide an element via inline `display: none !important`. Used for procedural
   * matches: their content can change between mutations, so we prefer hiding
   * (reversible-looking, framework-safe) over detaching. Idempotent.
   */
  function safeHide(el: Element): void {
    try {
      (el as HTMLElement).style?.setProperty('display', 'none', 'important');
    } catch {
      // A pathological node must never abort processing of the rest.
    }
  }

  function removeWithin(root: ParentNode): void {
    const list = selectorList(settings.removeSelectors);
    if (!list) return;
    for (const el of root.querySelectorAll(list)) safeRemove(el);
  }

  /**
   * Evaluate every procedural selector across `root` and hide matches.
   * For each selector we take the CSS-prefix candidates (or all elements when
   * the prefix is empty), then require every procedural operation to match.
   * Defensive and idempotent: hiding an already-hidden node is a no-op, and a
   * single bad selector/node never aborts the rest.
   */
  function applyProceduralWithin(root: ParentNode): void {
    if (cosmetics.procedural.length === 0) return;
    for (const sel of cosmetics.procedural) {
      let candidates: Iterable<Element>;
      try {
        candidates = sel.css
          ? root.querySelectorAll(sel.css)
          : root.querySelectorAll('*');
      } catch {
        continue; // Invalid CSS prefix: skip this selector entirely.
      }
      for (const el of candidates) {
        try {
          if (sel.procedural.every((op) => matchesOperation(el, op))) {
            safeHide(el);
          }
        } catch {
          // Per-node failure: keep going with the remaining candidates.
        }
      }
    }
  }

  /** Run all non-stylesheet passes (removal + procedural) over a subtree. */
  function sweep(root: ParentNode): void {
    removeWithin(root);
    applyProceduralWithin(root);
  }

  function startObserver(): void {
    sweep(document);
    observer?.disconnect();
    observer = new MutationObserver((mutations) => {
      try {
        const removeList = selectorList(settings.removeSelectors);
        const hasProcedural = cosmetics.procedural.length > 0;
        if (!removeList && !hasProcedural) return;
        for (const mutation of mutations) {
          // Added nodes: process the node itself and its subtree.
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            const el = node as Element;
            if (removeList && el.matches(removeList)) {
              safeRemove(el);
            } else if (removeList) {
              removeWithin(el);
            }
            applyProceduralWithin(el);
          }
          // Text / attribute / child changes can flip a procedural match on an
          // existing element, so re-evaluate procedural selectors for the
          // mutation target's subtree. (characterData mutations report the text
          // node as the target; walk up to its element.)
          if (hasProcedural) {
            const target =
              mutation.target.nodeType === Node.ELEMENT_NODE
                ? (mutation.target as Element)
                : (mutation.target.parentElement ?? null);
            if (target) applyProceduralWithin(target);
          }
        }
      } catch {
        // A single bad node/selector must never kill cosmetic filtering for the
        // rest of the page. Per-node failures are already contained in
        // safeRemove/safeHide; this is a final guard so the observer callback
        // can never throw out.
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  /**
   * Replace the per-hostname resolved cosmetic selectors (from the raw
   * `cosmeticFilters` text). Call before `injectStyles`/`startObserver`, or any
   * time the resolved set changes; re-applies immediately when active.
   */
  function setCosmetics(next: ResolvedCosmetics): void {
    cosmetics = next;
    if (settings.enabled) {
      injectStyles();
      sweep(document);
    }
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

  return { injectStyles, startObserver, setCosmetics, update };
}
