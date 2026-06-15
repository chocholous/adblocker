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
  /**
   * Device pixel ratio of the captured tab. Vision mode sends a screenshot whose
   * pixel dimensions are `viewport * dpr`; this lets the model relate the image
   * to each node's CSS-pixel `rect`. Omitted/1 when not relevant.
   */
  dpr?: number;
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

/**
 * Cosmetic-filter request from a content frame to the background engine.
 * DOM hints (classes/ids/hrefs) let the engine resolve GENERIC cosmetic filters
 * that can actually match the live page, keeping the injected stylesheet small.
 */
export interface EngineCosmeticsMessage {
  type: 'sch:engineCosmetics';
  url: string;
  hostname: string;
  domain: string | null;
  hints: { classes?: string[]; ids?: string[]; hrefs?: string[] };
}

/** Background's reply with the resolved hide-stylesheet + scriptlet sources. */
export interface EngineCosmeticsResponse {
  styles: string;
  scripts: string[];
}

/**
 * Network-rules-as-cosmetic request. A content frame collects resource-bearing
 * elements (iframe/img/video/source/embed/object), assigns each an id, and asks
 * the background engine which ones point at an ad/tracker resource according to
 * the engine's NETWORK filters. The matched elements are then HIDDEN (never
 * blocked) — the request still completes, so the server sees normal traffic.
 */
export interface MatchResourcesMessage {
  type: 'sch:matchResources';
  /** Frame URL, used as the request's `sourceUrl` (first-party context). */
  sourceUrl: string;
  items: { id: number; url: string; type: string }[];
}

/** Background's reply: the ids of items matched by the network filters. */
export interface MatchResourcesResponse {
  matched: number[];
}

// Runtime message envelopes.

/**
 * Popup → background: run the AI cleanup for a tab. Sent from the popup (which
 * holds the user gesture needed for `chrome.tabs.captureVisibleTab` in vision
 * mode) rather than from the content frame.
 */
export interface CleanupRequestMessage {
  type: 'sch:cleanupRequest';
  tabId: number;
}
/** Popup → content (top frame): preview-hide a set of selectors (unsaved). */
export interface PreviewMessage {
  type: 'sch:preview';
  selectors: string[];
}
export interface ClearPreviewMessage {
  type: 'sch:clearPreview';
}
/** Popup → content (top frame): activate the point-and-click element picker. */
export interface StartPickerMessage {
  type: 'sch:startPicker';
}
/** Background → content (top frame): build and return a page digest. */
export interface BuildDigestMessage {
  type: 'sch:buildDigest';
}

/** Content's reply to {@link BuildDigestMessage}. */
export type BuildDigestResponse =
  | { ok: true; digest: PageDigest }
  | { ok: false; error: string };

export type RuntimeMessage =
  | CleanupRequestMessage
  | PreviewMessage
  | ClearPreviewMessage
  | StartPickerMessage
  | BuildDigestMessage
  | EngineCosmeticsMessage
  | MatchResourcesMessage;
