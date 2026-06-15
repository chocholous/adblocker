/**
 * Consent / cookie (CMP) wall handler.
 *
 * Policy: a consent wall must ALWAYS be dealt with.
 *  1. First try to REJECT — click a "reject all / decline / only necessary"
 *     control. This is the privacy-preserving outcome and also dismisses the
 *     wall.
 *  2. If no reject control can be found, HIDE the wall and UNLOCK scrolling so
 *     the page underneath is usable. Never leave a consent wall blocking.
 *
 * Some CMPs (e.g. Sourcepoint) render their dialog in a cross-origin iframe, so
 * besides the top frame we also run a REJECT-only pass inside vetted CMP iframes
 * (see {@link runConsentHandlerInFrame}); there we click reject but never hide.
 *
 * Hard requirement: ZERO false-positives. We must never click an unrelated
 * "Reject" button or hide real page content. Every action is gated behind a
 * consent-context check (the node must look like a cookie/consent dialog), and
 * the whole module is wrapped in try/catch so it can never break the page.
 *
 * The module is self-contained (no imports), idempotent, and safe to call
 * multiple times. It runs once at start and again for late-injected CMPs via a
 * short-lived MutationObserver.
 */

/** Known-CMP reject/decline/necessary-only controls (high precision). */
const REJECT_SELECTORS: readonly string[] = [
  // OneTrust
  '#onetrust-reject-all-handler',
  '.ot-pc-refuse-all-handler',
  // Didomi
  '#didomi-notice-disagree-button',
  'button.didomi-dismiss-button',
  'button.didomi-components-button--decline',
  '.didomi-continue-without-agreeing',
  // Google Funding Choices (`fc-consent-root`): "Do not consent" / "Manage".
  '.fc-cta-do-not-consent',
  '.fc-button.fc-cta-do-not-consent',
  // Cookiebot
  '#CybotCookiebotDialogBodyButtonDecline',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll',
  // Quantcast Choice
  '.qc-cmp2-summary-buttons button[mode="secondary"]',
  // TrustArc (reject / disagree variant)
  '.trustarc-agree-btn.trustarc-reject-btn',
  '#truste-consent-required',
  // Usercentrics
  'button[data-testid="uc-deny-all-button"]',
  '#uc-btn-deny-banner',
  // Termly
  'button[data-tid="banner-decline"]',
  // Osano
  '.osano-cm-denyAll',
  '.osano-cm-button--type_denyAll',
  // Klaro
  '.cm-btn-decline',
  '.cn-decline',
  // Seznam / CNC (CZ) common CMP markers
  '[data-testid="cw-button-reject-all"]',
  '.szn-cmp-dialog-container [data-testid*="reject" i]',
  '#cmp-btn-reject',
  // Generic data attributes some CMPs expose.
  'button[data-role="reject-all"]',
  'button[aria-label*="reject" i]',
] as const;

/**
 * Reject-text matcher (visible button text). EN + CZ + a couple DE.
 * Deliberately only applied to controls already inside a consent container.
 */
const REJECT_TEXT_RE =
  /\b(reject all|reject|decline|refuse|disagree|deny|only necessary|necessary only)\b|odm[ií]t(nout|am)?(\s+v[šs]e)?|nesouhlas[ií]?m?|zam[ií]tnout|(jen|pouze)\s+nezbytn|ablehnen|nur notwendige/i;

/**
 * Tokens that mark a node (or its ancestor) as a consent/cookie context.
 * Used both to scope reject-clicks and to decide what is safe to hide.
 */
const CONSENT_CONTEXT_RE =
  /cookie|consent|cmp|gdpr|souhlas|privacy|did[oó]mi|onetrust|cybotcookiebot|truste|usercentrics|osano|klaro|qc-cmp|trustarc|cpex/i;

/** Words that, inside a dialog, strongly imply a cookie/consent banner. */
const CONSENT_TEXT_RE =
  /cookie|consent|gdpr|souhlas|privacy|p[řr]edvolb|nastaven[ií] soukrom|we value your privacy|your privacy/i;

/** Max time we keep watching for late-injected CMPs. */
const OBSERVE_MS = 8000;

/** Attribute we stamp on nodes we've already handled (idempotency). */
const HANDLED_ATTR = 'data-sch-consent';

function isElement(node: Node | null | undefined): node is Element {
  return !!node && node.nodeType === 1;
}

/** Visible-text of an element, whitespace-collapsed. */
function visibleText(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function safeComputedStyle(el: Element): CSSStyleDeclaration | null {
  try {
    return el.ownerDocument?.defaultView?.getComputedStyle(el) ?? null;
  } catch {
    return null;
  }
}

/** True when the element is rendered (not display:none / hidden / detached). */
function isVisible(el: Element): boolean {
  try {
    const cs = safeComputedStyle(el);
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) {
      return false;
    }
    const he = el as HTMLElement;
    // In a real browser offsetParent === null means not rendered, EXCEPT for
    // fixed/sticky elements (overlays) which legitimately report null. happy-dom
    // returns undefined; treat undefined as "no info" so unit tests still pass.
    if (
      typeof he.offsetParent !== 'undefined' &&
      he.offsetParent === null &&
      he.tagName !== 'BODY' &&
      he.tagName !== 'HTML'
    ) {
      const pos = cs?.position;
      if (pos !== 'fixed' && pos !== 'sticky') return false;
    }
    return true;
  } catch {
    return true;
  }
}

function consentishDataAttrs(el: Element): string {
  try {
    const out: string[] = [];
    for (const a of Array.from(el.attributes)) {
      if (a.name.startsWith('data-')) out.push(`${a.name} ${a.value}`);
    }
    return out.join(' ');
  } catch {
    return '';
  }
}

/**
 * Does `el` (or an ancestor within `maxUp` hops) look like a consent/cookie
 * dialog? We check id/class/attributes for consent tokens, role=dialog paired
 * with cookie-ish text, or a sizeable notice that reads like a consent banner.
 */
function isConsentContext(el: Element | null, maxUp = 6): boolean {
  let cur: Element | null = el;
  let hops = 0;
  while (isElement(cur) && hops <= maxUp) {
    const id = cur.id || '';
    const cls = typeof cur.className === 'string' ? cur.className : '';
    if (CONSENT_CONTEXT_RE.test(`${id} ${cls}`)) return true;

    const aria = cur.getAttribute?.('aria-label') ?? '';
    if (CONSENT_CONTEXT_RE.test(`${aria} ${consentishDataAttrs(cur)}`)) {
      return true;
    }

    const role = cur.getAttribute?.('role');
    if (
      (role === 'dialog' || role === 'alertdialog') &&
      CONSENT_TEXT_RE.test(visibleText(cur))
    ) {
      return true;
    }

    cur = cur.parentElement;
    hops += 1;
  }
  return false;
}

/**
 * Climb from `inner` to the outermost ancestor that still reads as a consent
 * context, so we hide the whole wall (overlay + dialog) rather than just an
 * inner button. Returns null if none qualifies.
 */
function consentRoot(inner: Element): Element | null {
  let best: Element | null = null;
  let cur: Element | null = inner;
  let hops = 0;
  while (isElement(cur) && hops <= 8) {
    if (isConsentContext(cur, 0)) best = cur;
    if (cur === document.body || cur === document.documentElement) break;
    cur = cur.parentElement;
    hops += 1;
  }
  return best;
}

/** The visible label of a control (text + aria-label + value). */
function controlLabel(el: Element): string {
  const aria = el.getAttribute?.('aria-label') ?? '';
  const value =
    el instanceof HTMLInputElement
      ? (el.value ?? '')
      : ((el as HTMLElement).getAttribute?.('value') ?? '');
  return `${visibleText(el)} ${aria} ${value}`.trim();
}

/** Click an element once, marking it so the same control is never re-clicked. */
function clickOnce(el: Element): boolean {
  try {
    if (el.getAttribute(HANDLED_ATTR) === 'clicked') return false;
    el.setAttribute(HANDLED_ATTR, 'clicked');
    (el as HTMLElement).click?.();
    return true;
  } catch {
    return false;
  }
}

/**
 * Inline/control tags that are never themselves a consent WALL. A footer link
 * like `<a class="atm-cmp-link">Nastavení cookies</a>` matches the `cmp` token
 * but is just a link — hiding it is a (small) false-positive, so containers are
 * restricted to structural elements.
 */
const NON_WALL_TAGS = new Set([
  'A',
  'BUTTON',
  'SPAN',
  'LABEL',
  'INPUT',
  'SELECT',
  'OPTION',
  'SVG',
  'PATH',
  'IMG',
  'I',
  'B',
  'STRONG',
  'EM',
  'LI',
]);

/** Minimum rendered area (px²) for something to count as a consent wall. */
const MIN_WALL_AREA = 6000;

/**
 * A consent WALL is a sizeable structural block (banner/overlay/dialog), not a
 * tiny inline link or button. Gate on tag + rendered area so we never hide
 * incidental "cookie settings" links that merely carry a consent token.
 */
function isHideableWall(el: Element): boolean {
  if (NON_WALL_TAGS.has(el.tagName)) return false;
  try {
    const r = (el as HTMLElement).getBoundingClientRect?.();
    // Only reject on size when we have REAL geometry. A 0×0 rect means the
    // element isn't laid out (or we're under happy-dom in tests) — treat that as
    // "no size info" rather than "too small", so we don't drop real walls.
    if (
      r &&
      (r.width > 0 || r.height > 0) &&
      r.width * r.height < MIN_WALL_AREA
    )
      return false;
  } catch {
    // no geometry available — don't reject on size
  }
  return true;
}

/** Whitespace-collapsed rendered-text length of an element. */
function renderedTextLen(el: Element): number {
  try {
    const t = (el as HTMLElement).innerText ?? el.textContent ?? '';
    return t.replace(/\s+/g, ' ').trim().length;
  } catch {
    return 0;
  }
}

/**
 * Would hiding `root` blank the page? True when almost no rendered text would
 * remain outside `root` — i.e. the "wall" IS essentially the whole page (a
 * dedicated consent/paywall page such as cmp.seznam.cz), so hiding it leaves a
 * blank white page. On such pages hiding is strictly worse than leaving the wall
 * (the user can still read/interact); this guard preserves the ZERO-false-
 * positive promise. Overlays on top of real content are unaffected: the article
 * text behind them keeps `outside` well above the threshold.
 */
function wouldBlankPage(root: Element): boolean {
  try {
    const total = renderedTextLen(document.body ?? document.documentElement);
    if (total === 0) return false; // nothing rendered anyway; hiding is a no-op
    const inRoot = renderedTextLen(root);
    const outside = total - inRoot;
    // Blank only when the wall DOMINATES the page (>=90% of rendered text) AND
    // almost nothing would remain. An overlay over a real article fails both:
    // the article text keeps `outside` large and the ratio well below 0.9.
    return inRoot / total >= 0.9 && outside < 150;
  } catch {
    return false;
  }
}

/**
 * Collect distinct nodes that read as consent dialogs/overlays: elements with
 * consent tokens in id/class plus role=dialog elements, filtered to genuine
 * consent contexts that are currently visible and large enough to be a wall.
 */
function findConsentContainers(): Element[] {
  const out = new Set<Element>();
  let candidates: Element[] = [];
  try {
    candidates = Array.from(
      document.querySelectorAll(
        '[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],' +
          '[id*="cmp" i],[class*="cmp" i],[id*="gdpr" i],[class*="gdpr" i],' +
          '[class*="souhlas" i],[id*="souhlas" i],[id*="cpex" i],[class*="cpex" i],' +
          '[role="dialog"],[role="alertdialog"]',
      ),
    );
  } catch {
    // ignore
  }
  for (const el of candidates) {
    if (!isVisible(el)) continue;
    if (!isConsentContext(el, 2)) continue;
    if (!isHideableWall(el)) continue;
    out.add(el);
  }
  return Array.from(out);
}

/**
 * Visible clickable controls inside a scope (button / a / role=button / input).
 */
function controlsIn(scope: ParentNode): Element[] {
  try {
    return Array.from(
      scope.querySelectorAll(
        'button, a, [role="button"], input[type="button"], input[type="submit"]',
      ),
    ).filter((el) => isVisible(el));
  } catch {
    return [];
  }
}

/**
 * The scopes to search for consent controls. In a CMP IFRAME the whole frame IS
 * the consent dialog (its URL was vetted by the caller), so the document body is
 * the scope and per-element token gating is unnecessary. In the top frame we
 * restrict to token-matched consent containers as before.
 */
function consentScopes(consentFrame: boolean): Element[] {
  if (consentFrame) {
    const root = document.body ?? document.documentElement;
    return root ? [root] : [];
  }
  return findConsentContainers();
}

/**
 * Attempt to click a reject control. Returns true if a control was found,
 * clicked, and it sits inside a consent context. At most one click per call.
 */
function tryReject(consentFrame = false): boolean {
  // 1) Known-CMP selectors (already high-precision), still gated by context
  //    (skipped inside a vetted CMP iframe, where the frame is the context).
  for (const sel of REJECT_SELECTORS) {
    let nodes: Element[];
    try {
      nodes = Array.from(document.querySelectorAll(sel));
    } catch {
      continue;
    }
    for (const el of nodes) {
      if (!isVisible(el)) continue;
      if (!consentFrame && !isConsentContext(el)) continue;
      if (clickOnce(el)) return true;
    }
  }

  // 2) Text heuristic — STRICTLY scoped to consent containers. We only look at
  // clickable controls that live inside a node reading as a consent dialog.
  for (const container of consentScopes(consentFrame)) {
    for (const ctrl of controlsIn(container)) {
      if (!REJECT_TEXT_RE.test(controlLabel(ctrl))) continue;
      // Re-check the control itself is within consent context (guards against
      // odd nesting where the container matched but the control escaped it).
      if (!consentFrame && !isConsentContext(ctrl)) continue;
      if (clickOnce(ctrl)) return true;
    }
  }
  return false;
}

/**
 * Hide every detected consent overlay/dialog and restore scrolling. Only hides
 * nodes that pass the consent-context check, so generic content is never hidden.
 * Returns true if anything was hidden (or already hidden by us).
 */
function hideAndUnlock(): boolean {
  const containers = findConsentContainers();
  if (containers.length === 0) return false;
  let hidAny = false;
  for (const c of containers) {
    const root = consentRoot(c) ?? c;
    if (root.getAttribute(HANDLED_ATTR) === 'hidden') {
      hidAny = true;
      continue;
    }
    // ZERO-FP guard: never hide a wall that IS essentially the whole page (a
    // dedicated consent/paywall page). Hiding it would blank the page, which is
    // strictly worse than leaving the wall in place.
    if (wouldBlankPage(root)) {
      root.setAttribute(HANDLED_ATTR, 'kept');
      continue;
    }
    try {
      (root as HTMLElement).style?.setProperty('display', 'none', 'important');
      root.setAttribute(HANDLED_ATTR, 'hidden');
      hidAny = true;
    } catch {
      // ignore this node
    }
  }
  if (hidAny) restoreScrolling();
  return hidAny;
}

/**
 * Undo common scroll-locks CMPs apply to <html>/<body>: inline
 * overflow:hidden / position:fixed, and well-known scroll-lock class names.
 */
function restoreScrolling(): void {
  const SCROLL_LOCK_CLASSES = [
    'no-scroll',
    'noscroll',
    'overflow-hidden',
    'modal-open',
    'cookie-open',
    'consent-open',
    'cmp-open',
    'didomi-popup-open',
    'ot-overflow-hidden',
    'sp-message-open',
    'has-modal',
    'scroll-lock',
    'is-locked',
    'lock-scroll',
  ];
  for (const el of [document.documentElement, document.body]) {
    if (!isElement(el)) continue;
    try {
      const he = el as HTMLElement;
      const inlineOverflow = he.style?.overflow;
      if (inlineOverflow === 'hidden' || inlineOverflow === 'clip') {
        he.style.removeProperty('overflow');
      }
      if (he.style?.overflowY === 'hidden') {
        he.style.removeProperty('overflow-y');
      }
      if (he.style?.position === 'fixed') {
        he.style.removeProperty('position');
        he.style.removeProperty('top');
        he.style.removeProperty('left');
        he.style.removeProperty('width');
        he.style.removeProperty('height');
      }
      // If a stylesheet still locks scrolling, force it open.
      const cs = safeComputedStyle(el);
      if (cs && (cs.overflow === 'hidden' || cs.overflowY === 'hidden')) {
        he.style?.setProperty('overflow', 'auto', 'important');
      }
      for (const cls of SCROLL_LOCK_CLASSES) {
        if (he.classList?.contains(cls)) he.classList.remove(cls);
      }
    } catch {
      // never break the page over scroll restoration
    }
  }
}

/** Options for a handling pass / handler run. */
interface HandleOptions {
  /** Treat the whole frame as the consent context (vetted CMP iframe). */
  consentFrame?: boolean;
  /** Allow hiding the wall as a last resort. Off inside CMP iframes (pointless
   *  — the frame IS the CMP; clicking dismisses it from the host page). */
  allowHide?: boolean;
}

/**
 * One handling pass. Order: (1) REJECT (privacy-preserving, the default), then
 * (2) hide+unlock as a last resort (top frame only). Returns true if a consent
 * wall was acted upon.
 */
function handleOnce(opts: HandleOptions = {}): boolean {
  const { consentFrame = false, allowHide = true } = opts;
  try {
    if (tryReject(consentFrame)) {
      // A reject click usually makes the CMP remove its own overlay and restore
      // scrolling, but some leave scroll-locks behind — unlock anyway.
      restoreScrolling();
      return true;
    }
    return allowHide ? hideAndUnlock() : false;
  } catch {
    return false;
  }
}

/**
 * Run a handling pass now and watch the DOM for late-injected CMPs for a bounded
 * window. Everything is defensive; failures are swallowed so the page is never
 * broken.
 */
function startHandling(opts: HandleOptions): void {
  try {
    handleOnce(opts);
  } catch {
    // ignore
  }

  let observer: MutationObserver | null = null;
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    try {
      observer?.disconnect();
    } catch {
      // ignore
    }
  };

  try {
    let scheduled = false;
    observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      // Coalesce bursts of mutations into a single pass.
      setTimeout(() => {
        scheduled = false;
        try {
          handleOnce(opts);
        } catch {
          // ignore
        }
      }, 200);
    });
    const target = document.documentElement ?? document.body;
    if (target) {
      observer.observe(target, { childList: true, subtree: true });
      setTimeout(stop, OBSERVE_MS);
    }
  } catch {
    stop();
  }
}

/** Top-frame entry point: reject → hide. */
export function runConsentHandler(): void {
  startHandling({ consentFrame: false, allowHide: true });
}

/**
 * CMP-iframe entry point (e.g. Sourcepoint's cross-origin message frame). The
 * caller has vetted the frame URL as a CMP, so the frame is the consent context.
 * We click a REJECT control but never hide — the host page owns the iframe and a
 * successful reject makes the CMP remove it.
 */
export function runConsentHandlerInFrame(): void {
  startHandling({ consentFrame: true, allowHide: false });
}

/** Exported for unit tests only. */
export const __test = {
  tryReject,
  hideAndUnlock,
  handleOnce,
  restoreScrolling,
  isConsentContext,
  findConsentContainers,
  isHideableWall,
  wouldBlankPage,
};
