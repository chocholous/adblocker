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

  it('does not throw and degrades to display:none when remove() fails (React-style node)', () => {
    document.body.innerHTML = '<div class="junk">x</div>';
    const el = document.querySelector('.junk') as HTMLElement;
    // Mimic React/Next: the node is still tracked, so detaching throws
    // `Failed to execute 'removeChild' on 'Node'`.
    el.remove = () => {
      throw new Error("Failed to execute 'removeChild' on 'Node'");
    };

    const hider = createHider({ ...base, removeSelectors: ['.junk'] });
    expect(() => hider.startObserver()).not.toThrow();

    // Element stays in the DOM but is visually hidden instead of crashing.
    expect(document.querySelector('.junk')).not.toBeNull();
    expect(el.style.display).toBe('none');
    expect(el.style.getPropertyPriority('display')).toBe('important');
  });

  it('does not throw and hides dynamically-added nodes whose remove() fails', async () => {
    const hider = createHider({ ...base, removeSelectors: ['.junk'] });
    hider.startObserver();

    const el = document.createElement('div');
    el.className = 'junk';
    el.remove = () => {
      throw new Error("Failed to execute 'removeChild' on 'Node'");
    };
    expect(() => document.body.appendChild(el)).not.toThrow();

    // MutationObserver callbacks are async (microtask) in happy-dom.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(el.isConnected).toBe(true);
    expect(el.style.display).toBe('none');
  });

  it('one throwing node does not prevent other matched elements from being processed', () => {
    document.body.innerHTML =
      '<div class="junk" id="bad">x</div><div class="junk" id="good">y</div>';
    const bad = document.getElementById('bad') as HTMLElement;
    bad.remove = () => {
      throw new Error("Failed to execute 'removeChild' on 'Node'");
    };

    const hider = createHider({ ...base, removeSelectors: ['.junk'] });
    expect(() => hider.startObserver()).not.toThrow();

    // The throwing node is hidden (still present), the healthy node detaches.
    expect(document.getElementById('bad')).not.toBeNull();
    expect((document.getElementById('bad') as HTMLElement).style.display).toBe(
      'none',
    );
    expect(document.getElementById('good')).toBeNull();
  });

  it('re-processing a node is idempotent and safe', () => {
    document.body.innerHTML = '<div class="junk">x</div>';
    const el = document.querySelector('.junk') as HTMLElement;
    el.remove = () => {
      throw new Error("Failed to execute 'removeChild' on 'Node'");
    };

    const hider = createHider({ ...base, removeSelectors: ['.junk'] });
    hider.startObserver();
    // Run the initial sweep again; must not throw and stays hidden.
    expect(() => hider.startObserver()).not.toThrow();
    expect(el.style.display).toBe('none');
  });

  it('produces no stylesheet content when disabled', () => {
    const hider = createHider({ ...base, hideSelectors: ['.ad'] });
    hider.injectStyles();
    hider.update({ ...base, enabled: false, hideSelectors: ['.ad'] });

    expect(document.getElementById('sch-cosmetic-style')).toBeNull();
  });
});
