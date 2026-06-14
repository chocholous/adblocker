import type { PageDigest, DigestNode } from './detect';

/**
 * Builds a stable, reasonably unique CSS selector for an element: an id when one
 * uniquely identifies it, otherwise a `>`-joined path using :nth-of-type.
 */
export function cssPath(el: Element): string {
  if (
    el.id &&
    document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1
  ) {
    return `#${CSS.escape(el.id)}`;
  }

  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.documentElement) {
    if (
      node.id &&
      document.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1
    ) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      break;
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
  }
  return parts.join(' > ');
}

const SKIP_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'svg',
  'path',
  'meta',
  'link',
  'head',
  'br',
  'hr',
]);

/**
 * Walks the rendered page and produces a compact digest of candidate "block"
 * elements for the model to triage. We deliberately cap the count, drop
 * invisible/oversized/tiny nodes, and truncate text — this keeps the payload
 * (and therefore cost and what leaves the browser) small.
 */
export function buildPageDigest(maxNodes = 120): PageDigest {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const viewportArea = vw * vh;

  const candidates: { el: Element; area: number }[] = [];
  const all = document.body?.querySelectorAll('*') ?? [];

  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) continue;

    const hasClass =
      typeof el.className === 'string' && el.className.trim().length > 0;
    const hasHook =
      !!el.id ||
      hasClass ||
      !!el.getAttribute('role') ||
      !!el.getAttribute('aria-label');
    if (!hasHook) continue;

    const rect = (el as HTMLElement).getBoundingClientRect();
    const area = rect.width * rect.height;
    // Skip slivers and full-page wrappers — neither is a useful clutter target.
    if (area < 600 || area > viewportArea * 0.85) continue;

    const style = getComputedStyle(el as HTMLElement);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0'
    ) {
      continue;
    }

    candidates.push({ el, area });
  }

  candidates.sort((a, b) => b.area - a.area);

  const nodes: DigestNode[] = [];
  for (const { el } of candidates.slice(0, maxNodes)) {
    const rect = (el as HTMLElement).getBoundingClientRect();
    const node: DigestNode = {
      sel: cssPath(el),
      tag: el.tagName.toLowerCase(),
      rect: [
        Math.round(rect.x),
        Math.round(rect.y),
        Math.round(rect.width),
        Math.round(rect.height),
      ],
    };
    if (el.id) node.id = el.id;
    if (typeof el.className === 'string' && el.className.trim()) {
      node.cls = el.className.trim().split(/\s+/).slice(0, 6).join(' ');
    }
    const role = el.getAttribute('role');
    if (role) node.role = role;
    const aria = el.getAttribute('aria-label');
    if (aria) node.aria = aria.slice(0, 60);
    const text = ((el as HTMLElement).innerText || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 80);
    if (text) node.text = text;
    nodes.push(node);
  }

  return {
    url: location.hostname + location.pathname,
    title: document.title.slice(0, 120),
    viewport: [vw, vh],
    nodes,
  };
}
