import { describe, it, expect, beforeEach } from 'vitest';
import { cssPath, buildPageDigest } from '../lib/digest';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('cssPath', () => {
  it('returns a unique id selector when available', () => {
    document.body.innerHTML = '<div id="uniq"></div>';
    const el = document.getElementById('uniq')!;
    expect(cssPath(el)).toBe('#uniq');
  });

  it('builds an nth-of-type path that resolves back to the element', () => {
    document.body.innerHTML = '<ul><li></li><li class="target"></li></ul>';
    const el = document.querySelector('li.target')!;
    const sel = cssPath(el);
    expect(document.querySelectorAll(sel)).toHaveLength(1);
    expect(document.querySelector(sel)).toBe(el);
  });
});

describe('buildPageDigest', () => {
  it('returns a well-formed digest object', () => {
    document.body.innerHTML = '<div id="x" class="card">hello</div>';
    const digest = buildPageDigest();
    expect(Array.isArray(digest.nodes)).toBe(true);
    expect(typeof digest.title).toBe('string');
    expect(digest.viewport).toHaveLength(2);
  });
});
