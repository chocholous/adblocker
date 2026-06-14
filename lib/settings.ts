import { storage } from 'wxt/utils/storage';

/**
 * User-configurable filtering settings, persisted in chrome.storage.sync so they
 * follow the user across devices. Read by the content scripts and the popup UI.
 */
export interface HiderSettings {
  /** Master on/off switch. */
  enabled: boolean;
  /** CSS selectors hidden via `display: none` (element stays in the DOM). */
  hideSelectors: string[];
  /** CSS selectors whose matches are fully detached from the DOM. */
  removeSelectors: string[];
  /** Neutralize common anti-adblock bait checks from the MAIN-world scriptlet. */
  spoofAntiAdblock: boolean;
  /**
   * Raw uBlock Origin / EasyList cosmetic-filter text. Parsed at runtime by
   * {@link parseCosmeticFilters} and resolved per-hostname so domain-scoped and
   * procedural (`:has-text`, `:has`, …) rules can be applied alongside the plain
   * `hideSelectors`/`removeSelectors`. Defaults to an empty string.
   */
  cosmeticFilters: string;
}

export const DEFAULT_SETTINGS: HiderSettings = {
  enabled: true,
  // Curated generic selectors validated against a real-site vision study (CNN,
  // Healthline, TechRadar, Tom's Hardware, BoredPanda, FoodNetwork). Only the
  // precise/token forms below are used: broad `[class*="ad"]` / `[id*="ad"]`
  // matchers were proven to destroy real content (e.g. CNN `header__*`,
  // FoodNetwork hero) and are intentionally excluded.
  hideSelectors: [
    // Pre-existing defaults.
    '[data-ad]',
    '[id*="sponsored" i]',
    '[class*="sponsored" i]',
    '.newsletter-wall',
    '.cookie-banner',
    // Generic ad markers (GPT / AdSense / DoubleClick).
    '[aria-label="advertisement" i]',
    'iframe[id^="google_ads_iframe"]',
    '[id^="div-gpt-ad"]',
    '[data-google-query-id]',
    'ins.adsbygoogle',
    'iframe[src*="doubleclick" i]',
    'iframe[src*="googlesyndication" i]',
    // Native-ad networks.
    '[id*="taboola" i]',
    '[class*="taboola" i]',
    '[id*="outbrain" i]',
    '[class*="outbrain" i]',
    // Precise ad-slot tokens (no broad `ad` substring match).
    '[class~="ads"]',
    '[class*="ad-slot" i]',
    '[class*="ad-unit" i]',
    '[class*="ad-container" i]',
    // OneTrust consent banner.
    '#onetrust-banner-sdk',
    '#onetrust-consent-sdk',
    '.onetrust-pc-dark-filter',
    // Newsletter prompts.
    '[class*="newsletter" i]',
    '[id*="newsletter" i]',
  ],
  removeSelectors: [],
  spoofAntiAdblock: true,
  cosmeticFilters: '',
};

/**
 * Single source of truth for settings. Both content scripts and the popup read
 * and write through this item; `.watch()` lets live tabs react to changes.
 */
export const settingsItem = storage.defineItem<HiderSettings>('sync:settings', {
  fallback: DEFAULT_SETTINGS,
  version: 2,
  migrations: {
    // v1 -> v2: `cosmeticFilters` was introduced. Existing stored settings have
    // no such field, so default it to '' without touching any other user data.
    2: (old: Partial<HiderSettings> | null): HiderSettings => ({
      ...DEFAULT_SETTINGS,
      ...(old ?? {}),
      cosmeticFilters: old?.cosmeticFilters ?? '',
    }),
  },
});

/**
 * Serialize a full {@link HiderSettings} to a pretty-printed JSON string for
 * the popup's Export action. The result round-trips losslessly through
 * {@link parseSettings}.
 */
export function serializeSettings(settings: HiderSettings): string {
  return JSON.stringify(settings, null, 2);
}

/**
 * Parse and validate a JSON string produced by {@link serializeSettings} (or
 * pasted/uploaded by the user) back into a {@link HiderSettings}.
 *
 * Validation is strict on shape but tolerant of missing optional-feeling fields:
 * any field absent from the JSON falls back to its {@link DEFAULT_SETTINGS}
 * value, so importing an older export (e.g. one without `cosmeticFilters`) never
 * throws. Throws on malformed JSON or wrong field types.
 */
export function parseSettings(json: string): HiderSettings {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('Not valid JSON.');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Expected a settings object.');
  }
  const obj = raw as Record<string, unknown>;

  const bool = (key: keyof HiderSettings, fallback: boolean): boolean => {
    const v = obj[key];
    if (v === undefined) return fallback;
    if (typeof v !== 'boolean') throw new Error(`"${key}" must be a boolean.`);
    return v;
  };
  const strArray = (key: keyof HiderSettings, fallback: string[]): string[] => {
    const v = obj[key];
    if (v === undefined) return fallback;
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
      throw new Error(`"${key}" must be an array of strings.`);
    }
    return v as string[];
  };
  const str = (key: keyof HiderSettings, fallback: string): string => {
    const v = obj[key];
    if (v === undefined) return fallback;
    if (typeof v !== 'string') throw new Error(`"${key}" must be a string.`);
    return v;
  };

  return {
    enabled: bool('enabled', DEFAULT_SETTINGS.enabled),
    hideSelectors: strArray('hideSelectors', DEFAULT_SETTINGS.hideSelectors),
    removeSelectors: strArray(
      'removeSelectors',
      DEFAULT_SETTINGS.removeSelectors,
    ),
    spoofAntiAdblock: bool(
      'spoofAntiAdblock',
      DEFAULT_SETTINGS.spoofAntiAdblock,
    ),
    cosmeticFilters: str('cosmeticFilters', DEFAULT_SETTINGS.cosmeticFilters),
  };
}

/**
 * Anthropic API key for the on-demand AI cleanup feature. Stored in `local`
 * (NOT `sync`) so a secret is never synced across devices.
 */
export const apiKeyItem = storage.defineItem<string>('local:anthropicApiKey', {
  fallback: '',
});
