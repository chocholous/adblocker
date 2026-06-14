import { describe, it, expect } from 'vitest';
import { FiltersEngine } from '@ghostery/adblocker';
import { resolveCosmetics } from '@/lib/engine';
import { collectDomHints } from '@/lib/dom-hints';
import { parseCosmeticFilters, selectorsForHostname } from '@/lib/filterlist';

/**
 * Build a small in-memory engine from a fixture list so these tests are
 * deterministic and need no network. Mirrors the real list shapes:
 * hostname-specific hides, generic (DOM-resolved) hides, and a network filter.
 */
function fixtureEngine(): FiltersEngine {
  const list = [
    '! fixture list',
    // hostname-specific cosmetic hide
    'example.com##.example-ad',
    'example.com###promo-banner',
    // generic cosmetic hides (only surface when DOM hints contain the token)
    '##.generic-ad',
    '###generic-ad-slot',
    // network filter
    '||tracker.example^$script',
  ].join('\n');
  return FiltersEngine.parse(list, {
    enableCompression: true,
    loadGenericCosmeticsFilters: true,
  });
}

describe('engine cosmetics resolution', () => {
  it('resolves hostname-specific hide selectors for a known host', () => {
    const engine = fixtureEngine();
    const { styles } = resolveCosmetics(
      engine,
      'https://example.com/',
      'example.com',
      'example.com',
    );
    expect(styles).toContain('.example-ad');
    expect(styles).toContain('#promo-banner');
    expect(styles).toContain('display: none');
  });

  it('does NOT apply another host’s specific selectors', () => {
    const engine = fixtureEngine();
    const { styles } = resolveCosmetics(
      engine,
      'https://other.test/',
      'other.test',
      'other.test',
    );
    expect(styles).not.toContain('.example-ad');
  });

  it('surfaces generic hides only when the DOM hint token is present', () => {
    const engine = fixtureEngine();
    const without = resolveCosmetics(
      engine,
      'https://news.test/',
      'news.test',
      'news.test',
    );
    expect(without.styles).not.toContain('.generic-ad');

    const withHints = resolveCosmetics(
      engine,
      'https://news.test/',
      'news.test',
      'news.test',
      { classes: ['generic-ad'], ids: ['generic-ad-slot'] },
    );
    expect(withHints.styles).toContain('.generic-ad');
    expect(withHints.styles).toContain('#generic-ad-slot');
  });

  it('returns empty cosmetics for a frame with no matching rules', () => {
    const engine = fixtureEngine();
    const { styles, scripts } = resolveCosmetics(
      engine,
      'https://nomatch.test/',
      'nomatch.test',
      'nomatch.test',
    );
    expect(styles).toBe('');
    expect(scripts).toEqual([]);
  });

  it('round-trips through serialize/deserialize', () => {
    const engine = fixtureEngine();
    const restored = FiltersEngine.deserialize(engine.serialize());
    const { styles } = resolveCosmetics(
      restored,
      'https://example.com/',
      'example.com',
      'example.com',
    );
    expect(styles).toContain('.example-ad');
  });
});

describe('engine + user filters merge', () => {
  it('engine selectors and user cosmeticFilters both contribute', () => {
    const engine = fixtureEngine();
    const engineCss = resolveCosmetics(
      engine,
      'https://example.com/',
      'example.com',
      'example.com',
    ).styles;

    // User-provided cosmetic filter for the same host (procedural layer path).
    const userSet = parseCosmeticFilters('example.com##.user-added-ad');
    const userResolved = selectorsForHostname(userSet, 'example.com');

    expect(engineCss).toContain('.example-ad'); // from the engine
    expect(userResolved.css).toContain('.user-added-ad'); // from user filters
    // The two layers are independent stylesheets in the hider, so both apply.
    expect(engineCss).not.toContain('.user-added-ad');
  });
});

describe('collectDomHints', () => {
  it('collects classes, ids, and hrefs from the document', () => {
    document.body.innerHTML = `
      <div class="generic-ad foo" id="promo-banner"></div>
      <a href="https://ads.example/x">link</a>
      <span class="bar"></span>
    `;
    const hints = collectDomHints(document);
    expect(hints.classes).toEqual(
      expect.arrayContaining(['generic-ad', 'foo', 'bar']),
    );
    expect(hints.ids).toContain('promo-banner');
    expect(hints.hrefs).toContain('https://ads.example/x');
  });

  it('de-duplicates repeated tokens', () => {
    document.body.innerHTML = `
      <div class="dup"></div><div class="dup"></div><div class="dup"></div>
    `;
    const hints = collectDomHints(document);
    expect(hints.classes.filter((c) => c === 'dup')).toHaveLength(1);
  });

  it('returns empty arrays for an empty subtree', () => {
    const empty = document.createElement('div');
    const hints = collectDomHints(empty);
    expect(hints.classes).toEqual([]);
    expect(hints.ids).toEqual([]);
    expect(hints.hrefs).toEqual([]);
  });
});
