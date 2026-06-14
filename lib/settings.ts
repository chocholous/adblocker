import { storage } from 'wxt/storage';

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
  hideSelectors: [
    '[data-ad]',
    '[id*="sponsored" i]',
    '[class*="sponsored" i]',
    '.newsletter-wall',
    '.cookie-banner',
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
