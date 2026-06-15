import { storage } from 'wxt/utils/storage';

/**
 * Authentication method for the on-demand AI cleanup feature.
 * - `apiKey`: a BYO Anthropic API key (`x-api-key` header).
 * - `oauth`: a Claude subscription OAuth access token (`Authorization: Bearer`).
 */
export type AiAuthMethod = 'apiKey' | 'oauth';

/** Selectable Claude model tier for the on-demand AI cleanup feature. */
export type AiModelTier = 'haiku' | 'sonnet' | 'opus';

/**
 * Map a {@link AiModelTier} to the concrete Anthropic model ID used in the call.
 * Kept here (not in lib/anthropic.ts) so it has no SDK dependency and stays
 * unit-testable in isolation.
 */
export const AI_MODEL_IDS: Record<AiModelTier, string> = {
  haiku: 'claude-haiku-4-5',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-8',
};

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
  /**
   * Automatically deal with cookie/consent (CMP) walls: first try to click a
   * "reject all / decline / only necessary" control, and if none is found, hide
   * the wall and restore scrolling. Defaults to `true`.
   */
  dismissConsent: boolean;
  /**
   * Which credential the AI cleanup uses: a BYO API key (`apiKey`) or a Claude
   * subscription OAuth token (`oauth`). The credentials themselves live in
   * `chrome.storage.local` (never synced); this is just the selector. Defaults
   * to `apiKey` (the TASK-014 behavior).
   */
  aiAuthMethod: AiAuthMethod;
  /** Claude model tier for AI cleanup. Defaults to `haiku` (fast/cheap). */
  aiModel: AiModelTier;
  /**
   * When true, AI cleanup captures a screenshot of the visible tab and sends it
   * to the (multimodal) model alongside the digest, so first-party/native ads a
   * text-only digest misses can still be flagged. Defaults to off.
   */
  aiVision: boolean;
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
    // Seznam SSP / Sklik ad slots (seznam.cz, novinky.cz, sport.cz …).
    '[class*="ssp-advert" i]',
    // CPEx subscription/consent wall (CNC sites: blesk.cz, reflex.cz …) — no
    // reject control, so hide the whole CPEx overlay deterministically.
    '[id^="cpexSubs" i]',
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
  dismissConsent: true,
  aiAuthMethod: 'apiKey',
  aiModel: 'haiku',
  aiVision: false,
};

/**
 * Single source of truth for settings. Both content scripts and the popup read
 * and write through this item; `.watch()` lets live tabs react to changes.
 */
export const settingsItem = storage.defineItem<HiderSettings>('sync:settings', {
  fallback: DEFAULT_SETTINGS,
  version: 4,
  migrations: {
    // v1 -> v2: `cosmeticFilters` was introduced. Existing stored settings have
    // no such field, so default it to '' without touching any other user data.
    2: (old: Partial<HiderSettings> | null): HiderSettings => ({
      ...DEFAULT_SETTINGS,
      ...(old ?? {}),
      cosmeticFilters: old?.cosmeticFilters ?? '',
    }),
    // v2 -> v3: `dismissConsent` was introduced. Backfill it to `true` for
    // existing users (consent walls should be handled by default) while
    // preserving every previously-stored field, including `cosmeticFilters`.
    3: (old: Partial<HiderSettings> | null): HiderSettings => ({
      ...DEFAULT_SETTINGS,
      ...(old ?? {}),
      cosmeticFilters: old?.cosmeticFilters ?? '',
      dismissConsent: old?.dismissConsent ?? true,
    }),
    // v3 -> v4: AI deep-clean settings were introduced (auth method, model tier,
    // vision). Backfill each to its default for existing users while preserving
    // every previously-stored field.
    4: (old: Partial<HiderSettings> | null): HiderSettings => ({
      ...DEFAULT_SETTINGS,
      ...(old ?? {}),
      cosmeticFilters: old?.cosmeticFilters ?? '',
      dismissConsent: old?.dismissConsent ?? true,
      aiAuthMethod: old?.aiAuthMethod ?? 'apiKey',
      aiModel: old?.aiModel ?? 'haiku',
      aiVision: old?.aiVision ?? false,
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
  const enumStr = <T extends string>(
    key: keyof HiderSettings,
    allowed: readonly T[],
    fallback: T,
  ): T => {
    const v = obj[key];
    if (v === undefined) return fallback;
    if (typeof v !== 'string' || !allowed.includes(v as T)) {
      throw new Error(`"${key}" must be one of: ${allowed.join(', ')}.`);
    }
    return v as T;
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
    dismissConsent: bool('dismissConsent', DEFAULT_SETTINGS.dismissConsent),
    aiAuthMethod: enumStr<AiAuthMethod>(
      'aiAuthMethod',
      ['apiKey', 'oauth'],
      DEFAULT_SETTINGS.aiAuthMethod,
    ),
    aiModel: enumStr<AiModelTier>(
      'aiModel',
      ['haiku', 'sonnet', 'opus'],
      DEFAULT_SETTINGS.aiModel,
    ),
    aiVision: bool('aiVision', DEFAULT_SETTINGS.aiVision),
  };
}

/**
 * Anthropic API key for the on-demand AI cleanup feature. Stored in `local`
 * (NOT `sync`) so a secret is never synced across devices.
 */
export const apiKeyItem = storage.defineItem<string>('local:anthropicApiKey', {
  fallback: '',
});

/**
 * Claude subscription OAuth access token for the on-demand AI cleanup feature.
 * Like {@link apiKeyItem}, stored in `local` (NOT `sync`) so the secret is never
 * synced across devices. Used only when `aiAuthMethod === 'oauth'`.
 */
export const oauthTokenItem = storage.defineItem<string>(
  'local:anthropicOauthToken',
  { fallback: '' },
);
