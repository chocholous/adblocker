import { describe, it, expect, beforeEach } from 'vitest';
import { createHider } from '../lib/hider';
import type { HiderSettings } from '../lib/settings';

const base: HiderSettings = {
  enabled: true,
  hideSelectors: [],
  removeSelectors: [],
  spoofAntiAdblock: false,
  cosmeticFilters: '',
  dismissConsent: true,
  aiAuthMethod: 'apiKey',
  aiModel: 'haiku',
  aiVision: false,
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

  it('includes resolved cosmetic css selectors in the hide stylesheet', () => {
    const hider = createHider(base);
    hider.setCosmetics({ css: ['.ad-from-list'], procedural: [] });
    hider.injectStyles();

    const style = document.getElementById('sch-cosmetic-style');
    expect(style?.textContent).toContain('.ad-from-list');
    expect(style?.textContent).toContain('display: none');
  });

  it('injects engine cosmetics into a separate stylesheet that merges with defaults', () => {
    const hider = createHider({ ...base, hideSelectors: ['.default-ad'] });
    hider.injectStyles();
    hider.setEngineStyles('.engine-ad { display: none !important; }');

    const defaultStyle = document.getElementById('sch-cosmetic-style');
    const engineStyle = document.getElementById('sch-engine-style');
    // Two independent stylesheets: defaults stay synchronous, engine layers on.
    expect(defaultStyle?.textContent).toContain('.default-ad');
    expect(engineStyle?.textContent).toContain('.engine-ad');
    // Engine stylesheet must not clobber the default one.
    expect(defaultStyle?.textContent).not.toContain('.engine-ad');
  });

  it('removes the engine stylesheet when disabled', () => {
    const hider = createHider(base);
    hider.setEngineStyles('.engine-ad { display: none !important; }');
    expect(document.getElementById('sch-engine-style')).not.toBeNull();

    hider.update({ ...base, enabled: false });
    expect(document.getElementById('sch-engine-style')).toBeNull();
  });
});

describe('createHider procedural matching', () => {
  it(':has-text hides only the element containing the text (plain CSS over-matches)', () => {
    // Two structurally identical cards; plain `div.card` would hit BOTH, but the
    // procedural rule must hide only the one whose text says "Sponsored".
    document.body.innerHTML =
      '<div class="card" id="ad">Sponsored partner content</div>' +
      '<div class="card" id="real">Genuine editorial story</div>';

    const hider = createHider(base);
    hider.setCosmetics({
      css: [],
      procedural: [
        {
          css: 'div.card',
          procedural: [{ type: 'has-text', arg: 'sponsored' }],
        },
      ],
    });
    hider.startObserver();

    const ad = document.getElementById('ad') as HTMLElement;
    const real = document.getElementById('real') as HTMLElement;
    // The sponsored card is hidden; the editorial card is untouched. A single
    // CSS selector (`div.card`) could never make this distinction.
    expect(ad.style.display).toBe('none');
    expect(real.style.display).toBe('');
    // Hidden, not removed — both nodes stay in the DOM.
    expect(ad.isConnected).toBe(true);
    expect(real.isConnected).toBe(true);
  });

  it(':has hides an element that contains a matching descendant', () => {
    document.body.innerHTML =
      '<div class="box" id="withAd"><span class="adlabel">x</span></div>' +
      '<div class="box" id="clean"><span>y</span></div>';

    const hider = createHider(base);
    hider.setCosmetics({
      css: [],
      procedural: [
        { css: 'div.box', procedural: [{ type: 'has', arg: '.adlabel' }] },
      ],
    });
    hider.startObserver();

    expect(
      (document.getElementById('withAd') as HTMLElement).style.display,
    ).toBe('none');
    expect(
      (document.getElementById('clean') as HTMLElement).style.display,
    ).toBe('');
  });

  it('re-evaluates procedural matches on dynamically-added nodes', async () => {
    const hider = createHider(base);
    hider.setCosmetics({
      css: [],
      procedural: [
        {
          css: 'div.card',
          procedural: [{ type: 'has-text', arg: 'sponsored' }],
        },
      ],
    });
    hider.startObserver();

    const el = document.createElement('div');
    el.className = 'card';
    el.textContent = 'Sponsored item';
    document.body.appendChild(el);

    // MutationObserver callbacks are async (microtask) in happy-dom.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(el.style.display).toBe('none');
  });

  it('procedural hiding is idempotent across repeated sweeps', () => {
    document.body.innerHTML = '<div class="card" id="ad">Sponsored</div>';
    const hider = createHider(base);
    const cosmetics = {
      css: [],
      procedural: [
        {
          css: 'div.card',
          procedural: [{ type: 'has-text' as const, arg: 'sponsored' }],
        },
      ],
    };
    hider.setCosmetics(cosmetics);
    // Re-applying the same cosmetics sweeps again; must stay hidden, never throw.
    expect(() => hider.setCosmetics(cosmetics)).not.toThrow();
    expect((document.getElementById('ad') as HTMLElement).style.display).toBe(
      'none',
    );
  });
});
