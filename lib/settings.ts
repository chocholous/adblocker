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
};

/**
 * Single source of truth for settings. Both content scripts and the popup read
 * and write through this item; `.watch()` lets live tabs react to changes.
 */
export const settingsItem = storage.defineItem<HiderSettings>('sync:settings', {
  fallback: DEFAULT_SETTINGS,
  version: 1,
});

/**
 * Anthropic API key for the on-demand AI cleanup feature. Stored in `local`
 * (NOT `sync`) so a secret is never synced across devices.
 */
export const apiKeyItem = storage.defineItem<string>('local:anthropicApiKey', {
  fallback: '',
});
