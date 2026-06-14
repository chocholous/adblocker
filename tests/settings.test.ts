import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS,
  serializeSettings,
  parseSettings,
  type HiderSettings,
} from '../lib/settings';

describe('settings import/export round-trip', () => {
  it('parse(serialize(settings)) deeply equals the original, including cosmeticFilters', () => {
    const settings: HiderSettings = {
      enabled: false,
      hideSelectors: ['.ad', '#promo'],
      removeSelectors: ['.paywall'],
      spoofAntiAdblock: true,
      cosmeticFilters:
        'example.com##.banner\nexample.com##div.card:has-text(Sponsored)',
    };

    const restored = parseSettings(serializeSettings(settings));
    expect(restored).toEqual(settings);
  });

  it('round-trips the default settings losslessly', () => {
    expect(parseSettings(serializeSettings(DEFAULT_SETTINGS))).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it('serializes to readable JSON that contains every field', () => {
    const json = serializeSettings(DEFAULT_SETTINGS);
    const obj = JSON.parse(json);
    expect(Object.keys(obj).sort()).toEqual(
      [
        'cosmeticFilters',
        'enabled',
        'hideSelectors',
        'removeSelectors',
        'spoofAntiAdblock',
      ].sort(),
    );
  });

  it('fills missing cosmeticFilters from an older export with the default ""', () => {
    // Simulate a v1-era export that predates the cosmeticFilters field.
    const legacy = JSON.stringify({
      enabled: true,
      hideSelectors: ['.ad'],
      removeSelectors: [],
      spoofAntiAdblock: true,
    });
    const restored = parseSettings(legacy);
    expect(restored.cosmeticFilters).toBe('');
    expect(restored.hideSelectors).toEqual(['.ad']);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseSettings('{ not json')).toThrow(/JSON/);
  });

  it('rejects wrong field types', () => {
    expect(() => parseSettings(JSON.stringify({ enabled: 'yes' }))).toThrow(
      /boolean/,
    );
    expect(() =>
      parseSettings(JSON.stringify({ hideSelectors: [1, 2] })),
    ).toThrow(/array of strings/);
    expect(() =>
      parseSettings(JSON.stringify({ cosmeticFilters: 42 })),
    ).toThrow(/string/);
  });

  it('rejects non-object top-level JSON', () => {
    expect(() => parseSettings('[]')).toThrow(/settings object/);
    expect(() => parseSettings('"x"')).toThrow(/settings object/);
  });
});
