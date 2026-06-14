import { describe, it, expect, beforeEach } from 'vitest';
import { createHider } from '../lib/hider';
import type { HiderSettings } from '../lib/settings';

const base: HiderSettings = {
  enabled: true,
  hideSelectors: [],
  removeSelectors: [],
  spoofAntiAdblock: false,
};

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('createHider', () => {
  it('injects a display:none stylesheet for hideSelectors', () => {
    const hider = createHider({ ...base, hideSelectors: ['.ad', '.promo'] });
    hider.injectStyles();

    const style = document.getElementById('sch-cosmetic-style');
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain('.ad');
    expect(style?.textContent).toContain('.promo');
    expect(style?.textContent).toContain('display: none');
  });

  it('detaches existing removeSelectors matches when the observer starts', () => {
    document.body.innerHTML =
      '<div class="junk">x</div><div class="keep">y</div>';
    const hider = createHider({ ...base, removeSelectors: ['.junk'] });
    hider.startObserver();

    expect(document.querySelector('.junk')).toBeNull();
    expect(document.querySelector('.keep')).not.toBeNull();
  });

  it('produces no stylesheet content when disabled', () => {
    const hider = createHider({ ...base, hideSelectors: ['.ad'] });
    hider.injectStyles();
    hider.update({ ...base, enabled: false, hideSelectors: ['.ad'] });

    expect(document.getElementById('sch-cosmetic-style')).toBeNull();
  });
});
