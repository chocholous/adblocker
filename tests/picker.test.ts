import { describe, it, expect, beforeEach } from 'vitest';
import { buildSelector, persistSelector } from '../lib/picker';
import { settingsItem, DEFAULT_SETTINGS } from '../lib/settings';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('buildSelector', () => {
  it('prefers a unique #id and the result matches only the target', () => {
    document.body.innerHTML = `
      <div id="content">a</div>
      <div id="sidebar"><span id="ad-slot">ad</span></div>`;
    const el = document.getElementById('ad-slot')!;
    const sel = buildSelector(el);
    expect(sel).toBe('#ad-slot');
    expect(document.querySelectorAll(sel)).toHaveLength(1);
    expect(document.querySelector(sel)).toBe(el);
  });

  it('uses a tag + stable class combo when there is no usable id', () => {
    document.body.innerHTML = `
      <section class="article card">real</section>
      <aside class="promo card">promo</aside>`;
    const el = document.querySelector('aside')!;
    const sel = buildSelector(el);
    // Must uniquely match the target.
    expect(document.querySelectorAll(sel)).toHaveLength(1);
    expect(document.querySelector(sel)).toBe(el);
    // Should be class-based (not an nth-of-type path).
    expect(sel).toContain('aside');
    expect(sel).toContain('.promo');
    expect(sel).not.toContain('nth-of-type');
  });

  it('does not use dynamic/hashed/utility classes', () => {
    document.body.innerHTML = `
      <div class="real-one"></div>
      <div class="banner css-1q2w3e Button_a1b2c3 mt-4 md:flex sc-AxjAm"></div>`;
    const el = document.querySelectorAll('div')[1]!;
    const sel = buildSelector(el);
    expect(document.querySelectorAll(sel)).toHaveLength(1);
    expect(document.querySelector(sel)).toBe(el);
    // Only the stable `banner` class is allowed; the hashed/utility ones must
    // never appear in the selector.
    expect(sel).toContain('.banner');
    expect(sel).not.toContain('css-1q2w3e');
    expect(sel).not.toContain('Button_a1b2c3');
    expect(sel).not.toContain('mt-4');
    expect(sel).not.toContain('flex');
    expect(sel).not.toContain('sc-AxjAm');
  });

  it('falls back to a bounded :nth-of-type path when no id/class is usable', () => {
    document.body.innerHTML = `
      <ul><li></li><li></li><li>target</li></ul>`;
    const el = document.querySelectorAll('li')[2]!;
    const sel = buildSelector(el);
    expect(sel).toContain('nth-of-type');
    expect(document.querySelectorAll(sel)).toHaveLength(1);
    expect(document.querySelector(sel)).toBe(el);
  });

  it('skips an id that is shared by multiple elements (not unique)', () => {
    document.body.innerHTML = `
      <div id="dup" class="first"></div>
      <div id="dup" class="second"></div>`;
    const el = document.querySelector('.second')!;
    const sel = buildSelector(el);
    expect(document.querySelectorAll(sel)).toHaveLength(1);
    expect(document.querySelector(sel)).toBe(el);
    // The non-unique id must not be the chosen selector.
    expect(sel).not.toBe('#dup');
  });
});

describe('persistSelector', () => {
  beforeEach(async () => {
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, hideSelectors: [] });
  });

  it('appends a new selector to settings.hideSelectors', async () => {
    const added = await persistSelector('.promo');
    expect(added).toBe(true);
    const s = await settingsItem.getValue();
    expect(s.hideSelectors).toContain('.promo');
  });

  it('dedupes when the selector is already present', async () => {
    await persistSelector('.promo');
    const addedAgain = await persistSelector('.promo');
    expect(addedAgain).toBe(false);
    const s = await settingsItem.getValue();
    expect(s.hideSelectors.filter((x) => x === '.promo')).toHaveLength(1);
  });
});
