/**
 * DOM feature extraction for engine-driven GENERIC cosmetic filtering.
 *
 * `@ghostery/adblocker` (like uBO) stores generic cosmetic filters indexed by
 * the class / id / href token they target. To resolve which generics apply to a
 * page, we collect the actual classes, ids, and anchor hrefs present in the DOM
 * and hand them to the engine, which returns only the generic hide selectors
 * that can match. This keeps the injected stylesheet tiny instead of carrying
 * the entire generic ruleset.
 *
 * Pure and DOM-bounded: collection is capped so a pathologically large page
 * can never blow up the message payload or the engine query.
 */

/** Hard cap on tokens per category, to bound payload size and query cost. */
const MAX_TOKENS = 5000;

export interface DomHints {
  classes: string[];
  ids: string[];
  hrefs: string[];
}

/**
 * Collect classes, ids, and hrefs from a root (default: the whole document).
 * De-duplicated and capped. Defensive: any per-node failure is skipped so one
 * exotic node never aborts collection.
 */
export function collectDomHints(root: ParentNode = document): DomHints {
  const classes = new Set<string>();
  const ids = new Set<string>();
  const hrefs = new Set<string>();

  let elements: Iterable<Element>;
  try {
    elements = root.querySelectorAll('[class],[id],a[href]');
  } catch {
    return { classes: [], ids: [], hrefs: [] };
  }

  for (const el of elements) {
    try {
      if (el.id) ids.add(el.id);
      const cls = el.classList;
      for (let i = 0; i < cls.length; i += 1) {
        const c = cls.item(i);
        if (c) classes.add(c);
      }
      const href = el.getAttribute('href');
      if (href) hrefs.add(href);
    } catch {
      // Skip this node; keep collecting the rest.
    }
    if (
      classes.size > MAX_TOKENS &&
      ids.size > MAX_TOKENS &&
      hrefs.size > MAX_TOKENS
    ) {
      break;
    }
  }

  return {
    classes: cap(classes),
    ids: cap(ids),
    hrefs: cap(hrefs),
  };
}

function cap(set: Set<string>): string[] {
  const out: string[] = [];
  for (const v of set) {
    out.push(v);
    if (out.length >= MAX_TOKENS) break;
  }
  return out;
}
