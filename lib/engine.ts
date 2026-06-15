import { FiltersEngine, Request } from '@ghostery/adblocker';
import { browser } from 'wxt/browser';

/**
 * Hybrid filter-engine glue (background side).
 *
 * Loads a serialized `@ghostery/adblocker` `FiltersEngine` — pre-built from
 * EasyList / EasyPrivacy / uBlock Origin / AdGuard by `scripts/build-filters.mjs`
 * and bundled at `public/filter-engine.bin` — and exposes two things the rest of
 * the extension needs:
 *
 *  1. Cosmetic filtering: resolve the hide-stylesheet + scriptlets for a frame's
 *     URL/hostname, optionally narrowed by DOM hints (classes/ids/hrefs) so the
 *     engine's huge set of GENERIC cosmetic filters only contributes selectors
 *     that can actually match the live page. This is how uBO/Ghostery keep the
 *     injected stylesheet small.
 *  2. Network matching: decide whether a request should be blocked (used to
 *     answer content-script queries; full MV3 declarativeNetRequest conversion is
 *     a deferred follow-up — see TODO below).
 *
 * The engine is heavy (multi-MB), so it lives ONCE in the background service
 * worker and content scripts ask for resolved cosmetics over the message bus,
 * rather than every frame deserializing its own copy.
 */

/** Path (relative to the extension root) of the bundled serialized engine. */
const ENGINE_ASSET = 'filter-engine.bin';

/** Resolved cosmetics for a frame, in a structurally-cloneable shape. */
export interface EngineCosmetics {
  /** Plain-CSS hide stylesheet text (already `{ display:none !important }`). */
  styles: string;
  /** Scriptlet source strings to run in the page (MAIN world). */
  scripts: string[];
}

const EMPTY_COSMETICS: EngineCosmetics = { styles: '', scripts: [] };

let enginePromise: Promise<FiltersEngine | null> | null = null;

/**
 * Load and deserialize the bundled engine exactly once. Returns null (never
 * throws) if the asset is missing or corrupt, so the extension degrades to the
 * static default + user cosmetic filters instead of breaking.
 */
export function loadEngine(): Promise<FiltersEngine | null> {
  if (!enginePromise) {
    enginePromise = (async () => {
      try {
        const url = browser.runtime.getURL(`/${ENGINE_ASSET}`);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
        const buf = new Uint8Array(await res.arrayBuffer());
        return FiltersEngine.deserialize(buf);
      } catch (err) {
        console.warn('[engine] failed to load filter engine:', err);
        return null;
      }
    })();
  }
  return enginePromise;
}

/** DOM hints a content script can send so generic cosmetics can be resolved. */
export interface DomHints {
  classes?: string[];
  ids?: string[];
  hrefs?: string[];
}

/**
 * Resolve the cosmetic filters that apply to a frame. `getBaseRules`/
 * `getRulesFromHostname` pull in generic + hostname-specific hides and injection
 * (scriptlet) rules; when DOM hints are supplied, generic hides matching the
 * page's actual classes/ids/hrefs are added too (`getRulesFromDOM`).
 */
export async function cosmeticsForFrame(
  url: string,
  hostname: string,
  domain: string | null,
  hints: DomHints = {},
): Promise<EngineCosmetics> {
  const engine = await loadEngine();
  if (!engine) return EMPTY_COSMETICS;
  return resolveCosmetics(engine, url, hostname, domain, hints);
}

/**
 * Pure resolution against a given engine instance (no I/O), so it is unit
 * testable with a small in-memory fixture engine. `getBaseRules` +
 * `getRulesFromHostname` pull generic + hostname-specific hides and injection
 * rules; DOM hints additionally surface generic hides that match the live page.
 */
export function resolveCosmetics(
  engine: FiltersEngine,
  url: string,
  hostname: string,
  domain: string | null,
  hints: DomHints = {},
): EngineCosmetics {
  try {
    const hasHints = Boolean(
      hints.classes?.length || hints.ids?.length || hints.hrefs?.length,
    );
    const { styles, scripts } = engine.getCosmeticsFilters({
      url,
      hostname,
      domain,
      classes: hints.classes,
      ids: hints.ids,
      hrefs: hints.hrefs,
      getBaseRules: true,
      getInjectionRules: true,
      getRulesFromHostname: true,
      getRulesFromDOM: hasHints,
      // Extended (procedural :has-text) rules are intentionally NOT requested
      // here: they require the engine's opaque DOM matcher. Our own procedural
      // layer (lib/filterlist + lib/hider) covers :has-text/:has via the user's
      // cosmeticFilters setting. See TODO(network/extended) below.
      getExtendedRules: false,
    });
    return { styles: styles ?? '', scripts: scripts ?? [] };
  } catch (err) {
    console.warn('[engine] resolveCosmetics failed:', err);
    return EMPTY_COSMETICS;
  }
}

/**
 * Whether a network request would be matched by the engine's NETWORK filters.
 *
 * We never actually block the request (no declarativeNetRequest): the philosophy
 * is HIDE, NEVER BLOCK. The content script uses this verdict to HIDE the element
 * that sourced an ad/tracker resource AFTER it loads, so the server still sees
 * normal traffic (stealth). Network-filter exceptions (`@@…`) are respected
 * automatically — `engine.match` returns `match:false` when an allowlist rule
 * wins, so first-party / explicitly-unblocked resources are left alone.
 */
function matchesNetworkFilter(
  engine: FiltersEngine,
  details: { url: string; type: string; sourceUrl: string },
): boolean {
  try {
    const request = Request.fromRawDetails({
      url: details.url,
      type: details.type as Parameters<
        typeof Request.fromRawDetails
      >[0]['type'],
      sourceUrl: details.sourceUrl,
    });
    return engine.match(request).match;
  } catch {
    return false;
  }
}

/**
 * Async convenience wrapper around {@link matchesNetworkFilter} that loads the
 * shared engine. Returns false (never throws) when the engine is unavailable.
 */
export async function shouldBlockRequest(details: {
  url: string;
  type: string;
  sourceUrl: string;
}): Promise<boolean> {
  const engine = await loadEngine();
  if (!engine) return false;
  return matchesNetworkFilter(engine, details);
}

/** One resource a content frame wants matched against the network filters. */
export interface ResourceQuery {
  /** Opaque id the content script uses to map a verdict back to its element. */
  id: number;
  /** Absolute resource URL (iframe src, img src, …). */
  url: string;
  /** `@ghostery/adblocker` request type (sub_frame/image/media/script/other). */
  type: string;
}

/**
 * Pure resolution: given a list of {id,url,type} resources and the frame's
 * source URL, return the ids whose URL is matched by the engine's NETWORK
 * filters (ad/tracker), respecting exceptions. Defensive per-item so one bad URL
 * never aborts the batch. Unit-testable with an in-memory fixture engine.
 */
export function matchResources(
  engine: FiltersEngine,
  items: ResourceQuery[],
  sourceUrl: string,
): number[] {
  const matched: number[] = [];
  for (const item of items) {
    try {
      if (
        matchesNetworkFilter(engine, {
          url: item.url,
          type: item.type,
          sourceUrl,
        })
      ) {
        matched.push(item.id);
      }
    } catch {
      // Skip this item; keep matching the rest.
    }
  }
  return matched;
}

/**
 * Async wrapper around {@link matchResources} that loads the shared engine.
 * Returns an empty array (never throws) when the engine is unavailable.
 */
export async function matchResourcesForFrame(
  items: ResourceQuery[],
  sourceUrl: string,
): Promise<number[]> {
  const engine = await loadEngine();
  if (!engine) return [];
  try {
    return matchResources(engine, items, sourceUrl);
  } catch {
    return [];
  }
}
