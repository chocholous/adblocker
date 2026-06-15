/**
 * Point-and-click element picker. The user activates it from the popup, hovers
 * to highlight elements, clicks to select one, sees the generated selector +
 * a live preview of the hide, and confirms. The chosen selector is appended to
 * `settings.hideSelectors` so the existing hider keeps it hidden permanently.
 *
 * Everything is rendered into a CLOSED Shadow DOM host so the page cannot style,
 * read, or detect the picker UI, and the whole thing is wrapped defensively so a
 * misbehaving page can never break it.
 *
 * `buildSelector` is exported as a pure function for unit testing.
 */
import { settingsItem } from './settings';

const HOST_ID = 'sch-picker-host';

/**
 * Classes that look auto-generated, hashed, or otherwise unstable and so must
 * NOT be used to build a durable selector. Covers CSS-modules hashes
 * (`Button_abc123`), styled-components (`sc-1a2b3c`), emotion (`css-1q2w3e`),
 * utility frameworks (Tailwind: `mt-4`, `text-sm`, `md:flex`), and pure
 * gibberish hashes.
 */
const UNSTABLE_CLASS = [
  // CSS-modules / build-hash suffix: word + _ + alnum hash.
  /^.*_[a-z0-9]{4,}$/i,
  // styled-components / emotion generated prefixes.
  /^sc-[a-z0-9]+$/i,
  /^css-[a-z0-9]+$/i,
  // Tailwind-style utility classes (with optional responsive/state prefix).
  /^(?:sm|md|lg|xl|2xl|hover|focus|active|dark|group):/,
  /^-?(?:m|p|mt|mb|ml|mr|mx|my|pt|pb|pl|pr|px|py|w|h|gap|text|bg|border|rounded|flex|grid|font|leading|tracking|space|inset|top|bottom|left|right|z|opacity)-/,
  // Long opaque hashes (>= 6 chars, mixed letters+digits, no separators).
  /^(?=[a-z0-9]*[a-z])(?=[a-z0-9]*[0-9])[a-z0-9]{6,}$/i,
];

function isStableClass(cls: string): boolean {
  if (!cls) return false;
  return !UNSTABLE_CLASS.some((re) => re.test(cls));
}

function esc(value: string): string {
  // Use the platform CSS.escape when present (polyfilled in tests).
  const css = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS;
  return css?.escape ? css.escape(value) : value.replace(/[^\w-]/g, '\\$&');
}

/** True when `selector` matches exactly the one target element in the document. */
function matchesUniquely(selector: string, el: Element): boolean {
  try {
    const found = (el.ownerDocument ?? document).querySelectorAll(selector);
    return found.length === 1 && found[0] === el;
  } catch {
    return false;
  }
}

function stableClasses(el: Element): string[] {
  const raw = typeof el.className === 'string' ? el.className : '';
  return raw
    .trim()
    .split(/\s+/)
    .filter((c) => c.length > 0 && isStableClass(c));
}

/**
 * Build a robust, reasonably durable CSS selector that uniquely identifies `el`.
 *
 * Strategy, in order of preference:
 *   1. A unique `#id` (when the id is stable-looking and matches exactly one
 *      element).
 *   2. `tag` + a combination of stable classes (hashed/utility/dynamic classes
 *      are filtered out), verified unique via `querySelectorAll(...).length === 1`.
 *   3. A bounded `:nth-of-type` ancestor path (the always-correct fallback).
 *
 * Pure with respect to the picker — it only reads the DOM — so it is safe to
 * unit-test directly.
 */
export function buildSelector(el: Element): string {
  // 1. Unique, stable-looking id.
  const id = el.getAttribute('id');
  if (id && isStableClass(id)) {
    const sel = `#${esc(id)}`;
    if (matchesUniquely(sel, el)) return sel;
  }

  const tag = el.tagName.toLowerCase();

  // 2. tag + stable class combo. Try the full combo first, then each single
  // class with the tag (smallest stable selector wins), then growing prefixes.
  const classes = stableClasses(el);
  if (classes.length > 0) {
    const full = `${tag}${classes.map((c) => `.${esc(c)}`).join('')}`;
    if (matchesUniquely(full, el)) return full;
    for (const c of classes) {
      const sel = `${tag}.${esc(c)}`;
      if (matchesUniquely(sel, el)) return sel;
    }
    for (let n = 2; n < classes.length; n++) {
      const sel = `${tag}${classes
        .slice(0, n)
        .map((c) => `.${esc(c)}`)
        .join('')}`;
      if (matchesUniquely(sel, el)) return sel;
    }
  }

  // 3. Bounded :nth-of-type ancestor path. Anchor on a unique ancestor id when
  // we hit one to keep the path short.
  const doc = el.ownerDocument ?? document;
  const root = doc.documentElement;
  const parts: string[] = [];
  let node: Element | null = el;
  let depth = 0;
  while (node && node !== root && depth < 8) {
    const nodeId = node.getAttribute('id');
    if (
      nodeId &&
      isStableClass(nodeId) &&
      matchesUniquely(`#${esc(nodeId)}`, node)
    ) {
      parts.unshift(`#${esc(nodeId)}`);
      return parts.join(' > ');
    }
    let part = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter(
        (c) => c.tagName === node!.tagName,
      );
      if (sameTag.length > 1) {
        part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
    }
    parts.unshift(part);
    node = node.parentElement;
    depth++;
  }
  return parts.join(' > ');
}

/**
 * Append a selector to `settings.hideSelectors` (deduped) and persist it, so the
 * existing hider/watch keeps the element hidden across reloads and restarts.
 * Returns true when newly added, false when it was already present.
 */
export async function persistSelector(selector: string): Promise<boolean> {
  const current = await settingsItem.getValue();
  if (current.hideSelectors.includes(selector)) return false;
  await settingsItem.setValue({
    ...current,
    hideSelectors: [...current.hideSelectors, selector],
  });
  return true;
}

// ---------------------------------------------------------------------------
// Interactive picker (DOM). Guarded so importing this module is side-effect
// free; the UI is built only when startPicker() is called.
// ---------------------------------------------------------------------------

interface PickerHandle {
  destroy(): void;
}

let active: PickerHandle | null = null;

/**
 * Start (or restart) the interactive element picker in the top frame. Idempotent
 * — re-activating tears down any existing instance first so overlays never
 * stack. Wrapped so it can never throw out into the content script.
 */
export function startPicker(): void {
  try {
    active?.destroy();
    active = createPicker();
  } catch {
    // The picker must never break the page; swallow any setup failure.
    active = null;
  }
}

function createPicker(): PickerHandle {
  // Closed shadow root: the page can neither read nor restyle our UI, and
  // `host.shadowRoot` is null from the page's perspective.
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText =
    'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
  const shadow = host.attachShadow({ mode: 'closed' });
  document.documentElement.appendChild(host);

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .box {
      position: fixed; pointer-events: none; box-sizing: border-box;
      border: 2px solid #2563eb; background: rgba(37,99,235,0.18);
      border-radius: 3px; transition: all 40ms linear; display: none;
      z-index: 1;
    }
    .bar {
      position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%);
      max-width: 92vw; pointer-events: auto; display: none;
      font: 13px/1.4 system-ui, sans-serif; color: #1a1a1a;
      background: #fff; border: 1px solid #d1d5db; border-radius: 10px;
      box-shadow: 0 6px 24px rgba(0,0,0,0.25); padding: 10px 12px; z-index: 2;
    }
    .sel {
      display: block; font: 12px/1.4 ui-monospace, monospace;
      max-width: 60vw; overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap; margin-bottom: 8px; color: #2563eb;
    }
    .actions { display: flex; gap: 8px; align-items: center; }
    button {
      padding: 6px 14px; border: 0; border-radius: 6px; cursor: pointer;
      font: 13px system-ui, sans-serif; background: #2563eb; color: #fff;
    }
    button.secondary { background: transparent; color: #2563eb; border: 1px solid #2563eb; }
  `;
  shadow.appendChild(style);

  const box = document.createElement('div');
  box.className = 'box';
  shadow.appendChild(box);

  const bar = document.createElement('div');
  bar.className = 'bar';
  const selSpan = document.createElement('span');
  selSpan.className = 'sel';
  const actions = document.createElement('div');
  actions.className = 'actions';
  bar.append(selSpan, actions);
  shadow.appendChild(bar);

  // Preview <style> appended to the page so it composes with the page's own
  // styles (the box overlay lives inside the shadow, the preview must apply to
  // the page itself). Removed on teardown.
  let previewEl: HTMLStyleElement | null = null;
  const setPreview = (selector: string | null): void => {
    if (!previewEl) {
      previewEl = document.createElement('style');
      previewEl.id = 'sch-picker-preview';
      (document.head ?? document.documentElement).appendChild(previewEl);
    }
    previewEl.textContent = selector
      ? `${selector} { display: none !important; }`
      : '';
  };

  let hovered: Element | null = null;
  let chosen: Element | null = null;
  let chosenSelector = '';
  let undoTimer: ReturnType<typeof setTimeout> | null = null;

  const isOwnUi = (el: Element | null): boolean =>
    !!el && (el === host || host.contains(el));

  const highlight = (el: Element): void => {
    const r = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = `${r.left}px`;
    box.style.top = `${r.top}px`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
  };

  const onMove = (ev: MouseEvent): void => {
    if (chosen) return;
    const target = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!target || isOwnUi(target)) return;
    if (target === document.documentElement || target === document.body) return;
    hovered = target;
    highlight(target);
  };

  const clearActions = (): void => actions.replaceChildren();

  const makeButton = (
    label: string,
    cls: string,
    onClick: () => void,
  ): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return b;
  };

  const onUndo = async (selector: string): Promise<void> => {
    try {
      const current = await settingsItem.getValue();
      await settingsItem.setValue({
        ...current,
        hideSelectors: current.hideSelectors.filter((s) => s !== selector),
      });
    } catch {
      // ignore
    }
    destroy();
  };

  const onHide = async (): Promise<void> => {
    const selector = chosenSelector;
    try {
      await persistSelector(selector);
    } catch {
      // Even if persistence fails, keep the preview hiding it for this session.
    }
    // The saved selector is now hidden by the hider; drop our preview so we
    // don't double-style, then offer a brief Undo.
    setPreview(null);
    box.style.display = 'none';
    selSpan.textContent = 'Hidden';
    clearActions();
    const undo = makeButton('Undo', 'secondary', () => void onUndo(selector));
    const done = makeButton('Done', '', () => destroy());
    actions.append(undo, done);
    // Auto-dismiss the toolbar after a short window if the user does nothing.
    undoTimer = setTimeout(() => destroy(), 6000);
  };

  // Confirm step: show selector + live preview + Hide/Cancel.
  const showConfirm = (el: Element): void => {
    chosen = el;
    chosenSelector = buildSelector(el);
    highlight(el);
    selSpan.textContent = chosenSelector;
    selSpan.title = chosenSelector;
    setPreview(chosenSelector);
    clearActions();
    const hideBtn = makeButton('Hide', '', () => void onHide());
    actions.append(
      hideBtn,
      makeButton('Cancel', 'secondary', () => destroy()),
    );
    // Expose the Hide button's on-screen rect on the (page-visible) host as a
    // data attribute. The toolbar itself lives in a CLOSED shadow root, so this
    // is the only way an external driver (E2E test) can click Hide at a precise
    // location. Harmless in production — it's just a string of four numbers.
    try {
      requestAnimationFrame(() => {
        const r = hideBtn.getBoundingClientRect();
        host.setAttribute(
          'data-sch-hide-rect',
          `${r.left},${r.top},${r.width},${r.height}`,
        );
      });
    } catch {
      // ignore — production never reads this
    }
  };

  const onClick = (ev: MouseEvent): void => {
    const target = document.elementFromPoint(ev.clientX, ev.clientY);
    if (isOwnUi(target)) return; // clicks on our toolbar handled by buttons
    if (chosen) return;
    ev.preventDefault();
    ev.stopPropagation();
    const el = target ?? hovered;
    if (el && el !== document.documentElement && el !== document.body) {
      showConfirm(el);
    }
  };

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      destroy();
    }
  };

  function destroy(): void {
    if (undoTimer) {
      clearTimeout(undoTimer);
      undoTimer = null;
    }
    try {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
    } catch {
      // ignore
    }
    setPreview(null);
    previewEl?.remove();
    previewEl = null;
    host.remove();
    if (active === handle) active = null;
  }

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);

  // Show the toolbar immediately with a hint so the user knows what to do.
  selSpan.textContent = 'Hover an element, then click to select.';
  clearActions();
  actions.append(makeButton('Cancel', 'secondary', () => destroy()));
  bar.style.display = 'block';

  const handle: PickerHandle = { destroy };
  return handle;
}

/**
 * Programmatic selection path used by the E2E test (and any non-pointer driver):
 * select `el` directly and immediately persist its selector, returning the
 * selector that was saved. Tears down any active picker UI afterwards. Returns
 * null when no picker is active or selection fails.
 */
export async function selectAndHide(el: Element): Promise<string | null> {
  try {
    const selector = buildSelector(el);
    await persistSelector(selector);
    active?.destroy();
    return selector;
  } catch {
    return null;
  }
}
