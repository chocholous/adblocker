import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS,
  serializeSettings,
  parseSettings,
  AI_MODEL_IDS,
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
      dismissConsent: false,
      aiAuthMethod: 'oauth',
      aiModel: 'sonnet',
      aiVision: true,
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
        'aiAuthMethod',
        'aiModel',
        'aiVision',
        'cosmeticFilters',
        'dismissConsent',
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

  it('backfills the AI deep-clean fields to their defaults from an older export', () => {
    // A v3-era export predates aiAuthMethod / aiModel / aiVision.
    const legacy = JSON.stringify({
      enabled: true,
      hideSelectors: ['.ad'],
      removeSelectors: [],
      spoofAntiAdblock: true,
      cosmeticFilters: '',
      dismissConsent: true,
    });
    const restored = parseSettings(legacy);
    expect(restored.aiAuthMethod).toBe('apiKey');
    expect(restored.aiModel).toBe('haiku');
    expect(restored.aiVision).toBe(false);
  });

  it('rejects invalid enum values for aiAuthMethod / aiModel', () => {
    expect(() =>
      parseSettings(JSON.stringify({ aiAuthMethod: 'nope' })),
    ).toThrow(/aiAuthMethod/);
    expect(() => parseSettings(JSON.stringify({ aiModel: 'gpt' }))).toThrow(
      /aiModel/,
    );
  });

  it('backfills dismissConsent to its default (true) from an older export', () => {
    // A v2-era export predates the dismissConsent field.
    const legacy = JSON.stringify({
      enabled: true,
      hideSelectors: ['.ad'],
      removeSelectors: [],
      spoofAntiAdblock: true,
      cosmeticFilters: 'example.com##.x',
    });
    const restored = parseSettings(legacy);
    expect(restored.dismissConsent).toBe(true);
    // Existing fields are preserved.
    expect(restored.cosmeticFilters).toBe('example.com##.x');
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

describe('AI_MODEL_IDS', () => {
  it('maps each tier to its concrete Anthropic model id', () => {
    expect(AI_MODEL_IDS).toEqual({
      haiku: 'claude-haiku-4-5',
      sonnet: 'claude-sonnet-4-6',
      opus: 'claude-opus-4-8',
    });
  });
});
