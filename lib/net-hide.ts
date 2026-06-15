/**
 * Network-rules-as-cosmetic: HIDE (never block) elements whose resource URL is
 * matched by the engine's NETWORK filters.
 *
 * The engine bundled at `public/filter-engine.bin` carries thousands of network
 * rules (`||doubleclick.net^`, …) from EasyList/EasyPrivacy/uBO/AdGuard. We do
 * NOT use them to block requests (no declarativeNetRequest) — that would change
 * what the server sees and defeats the extension's stealth goal. Instead we let
 * every request load normally, then ask the background engine which loaded
 * resources match an ad/tracker network rule, and hide the elements that sourced
 * them with `display:none !important`.
 *
 * This module is DOM-bounded and pure-ish (the matcher is injected) so it is
 * unit-testable in happy-dom. Everything is defensive: any per-element failure
 * is swallowed so a pathological page can never break the hide pass.
 */

/** Marker attribute set on elements we have already hidden (idempotency). */
const HIDDEN_ATTR = 'data-sch-net-hidden';

/**
 * The resource-bearing element kinds we inspect, mapped to the
 * `@ghostery/adblocker` request type used for matching. Anything not listed is
 * not collected (we deliberately keep the surface small to avoid false matches
 * on, e.g., stylesheet `<link>`s whose hiding makes no sense).
 */
interface ResourceTarget {
  /** CSS selector locating the element. */
  selector: string;
  /** Attribute holding the resource URL. */
  attr: string;
  /** `@ghostery/adblocker` request type. */
  type: string;
}

const TARGETS: ResourceTarget[] = [
  { selector: 'iframe[src]', attr: 'src', type: 'sub_frame' },
  { selector: 'img[src]', attr: 'src', type: 'image' },
  { selector: 'video[src]', attr: 'src', type: 'media' },
  { selector: 'source[src]', attr: 'src', type: 'media' },
  { selector: 'embed[src]', attr: 'src', type: 'other' },
  { selector: 'object[data]', attr: 'data', type: 'other' },
];

/** One collected element + the request details the matcher needs. */
export interface CollectedResource {
  el: Element;
  url: string;
  type: string;
}

/**
 * Resolve a possibly-relative resource URL against the document base to an
 * absolute URL. Returns null for empty/data/blob/about/javascript URLs (the
 * engine can't meaningfully match those, and they are never third-party ads).
 */
function absolutize(raw: string, base: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^(data:|blob:|about:|javascript:|#)/i.test(v)) return null;
  try {
    const u = new URL(v, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}

/**
 * Collect resource-bearing elements under `root` that still have a usable URL
 * and have not already been hidden. De-duplicates per element. Defensive: a bad
 * selector or node never aborts collection.
 */
export function collectResources(
  root: ParentNode,
  base: string,
): CollectedResource[] {
  const out: CollectedResource[] = [];
  const seen = new Set<Element>();
  for (const target of TARGETS) {
    let nodes: Iterable<Element>;
    try {
      nodes = root.querySelectorAll(target.selector);
    } catch {
      continue;
    }
    for (const el of nodes) {
      try {
        if (seen.has(el)) continue;
        if (el.hasAttribute(HIDDEN_ATTR)) continue;
        const raw = el.getAttribute(target.attr);
        if (!raw) continue;
        const url = absolutize(raw, base);
        if (!url) continue;
        seen.add(el);
        out.push({ el, url, type: target.type });
      } catch {
        // Skip this node; keep collecting the rest.
      }
    }
  }
  return out;
}

/** Hide an element via inline `display:none !important`; idempotent + safe. */
function hideElement(el: Element): void {
  try {
    (el as HTMLElement).style?.setProperty('display', 'none', 'important');
    el.setAttribute(HIDDEN_ATTR, '1');
  } catch {
    // A pathological node must never abort processing of the rest.
  }
}

/**
 * Conservative container collapse. After hiding a matched element, if its DIRECT
 * parent now contains no other rendered content (it only wrapped the ad), hide
 * the parent too so the empty ad slot doesn't leave a gap. We deliberately do
 * NOT walk further up the tree: collapsing ancestors is the main false-positive
 * risk (real layout/section wrappers), so we stop at exactly one level and only
 * when the parent is an obvious sole-child wrapper.
 */
function maybeCollapseParent(el: Element): void {
  try {
    const parent = el.parentElement;
    if (!parent) return;
    // Never touch structural/landmark elements — collapsing these is how clean
    // pages lose real content.
    const tag = parent.tagName;
    if (
      tag === 'BODY' ||
      tag === 'HTML' ||
      tag === 'MAIN' ||
      tag === 'ARTICLE' ||
      tag === 'SECTION' ||
      tag === 'NAV' ||
      tag === 'HEADER' ||
      tag === 'FOOTER' ||
      tag === 'ASIDE'
    ) {
      return;
    }
    if (parent.hasAttribute(HIDDEN_ATTR)) return;
    // Only collapse when the matched element was the parent's sole element child
    // and the parent carries no visible text of its own. That is the signature
    // of a pure ad wrapper (e.g. `<div class="ad-slot"><iframe …></div>`).
    if (parent.childElementCount !== 1) return;
    const text = (parent.textContent ?? '').trim();
    if (text.length > 0) return;
    hideElement(parent);
  } catch {
    // Collapsing is best-effort; never let it break the pass.
  }
}

/** A function that, given collected resources, returns the matched indices. */
export type ResourceMatcher = (items: CollectedResource[]) => Promise<number[]>;

/**
 * Run one hide pass over `root`: collect resources, ask the matcher which are
 * ads/trackers, hide those elements (and conservatively collapse a sole-child
 * wrapper parent). Returns the number of elements hidden. Fully try/caught so it
 * can never throw out into the page.
 *
 * `cache` maps an absolute resource URL to its verdict so re-running over a
 * growing DOM never re-queries the same URL.
 */
export async function runHidePass(
  root: ParentNode,
  base: string,
  match: ResourceMatcher,
  cache: Map<string, boolean>,
): Promise<number> {
  try {
    const collected = collectResources(root, base);
    if (collected.length === 0) return 0;

    // Split into already-known (cached) verdicts and unknown URLs to query.
    const toQuery: CollectedResource[] = [];
    const cachedHits: CollectedResource[] = [];
    for (const item of collected) {
      const cached = cache.get(item.url);
      if (cached === true) cachedHits.push(item);
      else if (cached === undefined) toQuery.push(item);
      // cached === false: known non-ad, skip.
    }

    const queriedHits: CollectedResource[] = [];
    if (toQuery.length > 0) {
      let matchedIdx: number[] = [];
      try {
        matchedIdx = await match(toQuery);
      } catch {
        matchedIdx = [];
      }
      const hitSet = new Set(matchedIdx);
      // Record verdicts for every queried URL so the cache stays complete.
      toQuery.forEach((item, i) => {
        const isHit = hitSet.has(i);
        cache.set(item.url, isHit);
        if (isHit) queriedHits.push(item);
      });
    }

    let hidden = 0;
    for (const item of [...cachedHits, ...queriedHits]) {
      if (item.el.hasAttribute(HIDDEN_ATTR)) continue;
      hideElement(item.el);
      maybeCollapseParent(item.el);
      hidden += 1;
    }
    return hidden;
  } catch {
    return 0;
  }
}
