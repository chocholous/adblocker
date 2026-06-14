/**
 * Shared types for the on-demand AI page-cleanup detector. No DOM or SDK imports
 * here so the file is safe to import from both the content script and the
 * background service worker.
 */

/** One candidate element, as sent to the model. Kept compact to bound tokens. */
export interface DigestNode {
  /** Unique CSS selector, generated locally. The model must echo this verbatim. */
  sel: string;
  tag: string;
  id?: string;
  cls?: string;
  role?: string;
  aria?: string;
  /** Heavily truncated text snippet — structure matters more than content. */
  text?: string;
  /** [x, y, width, height], rounded. */
  rect: [number, number, number, number];
}

export interface PageDigest {
  /** hostname + pathname only (no query string) — enough context, less leakage. */
  url: string;
  title: string;
  viewport: [number, number];
  nodes: DigestNode[];
}

export interface DetectedRule {
  selector: string;
  label: string;
  category: string;
}

/**
 * Keep only rules whose selector was actually present in the digest we sent.
 * This is the guard that stops the model from injecting an arbitrary selector.
 * Pure (no DOM/SDK) so it is unit-testable in isolation.
 */
export function filterToAllowedSelectors(
  rules: DetectedRule[],
  allowed: Set<string>,
): DetectedRule[] {
  return rules.filter((rule) => allowed.has(rule.selector));
}

export type DetectResponse =
  | { ok: true; rules: DetectedRule[] }
  | { ok: false; error: string };

/** Result the popup receives back from the content script. */
export type CleanupResult = DetectResponse;

// Runtime message envelopes.
export interface DetectMessage {
  type: 'sch:detect';
  digest: PageDigest;
}
export interface CleanupMessage {
  type: 'sch:cleanup';
}
export interface ClearPreviewMessage {
  type: 'sch:clearPreview';
}
export type RuntimeMessage =
  | DetectMessage
  | CleanupMessage
  | ClearPreviewMessage;
