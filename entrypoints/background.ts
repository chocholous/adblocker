import { defineBackground } from 'wxt/sandbox';
import { browser } from 'wxt/browser';
import { settingsItem, apiKeyItem } from '@/lib/settings';
import { detectElementsToHide } from '@/lib/anthropic';
import type { DetectResponse, PageDigest, RuntimeMessage } from '@/lib/detect';

/**
 * The MV3 service worker. Seeds default settings on install, and handles the
 * one privileged operation that must not run in a page context: calling the
 * Anthropic API for on-demand cleanup (keeps the API key out of web pages).
 */
export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async () => {
    const current = await settingsItem.getValue();
    await settingsItem.setValue(current);
  });

  browser.runtime.onMessage.addListener((message: unknown) => {
    const msg = message as RuntimeMessage | undefined;
    if (msg?.type === 'sch:detect') {
      return handleDetect(msg.digest);
    }
    // Returning undefined lets other listeners (e.g. in content scripts) respond.
    return undefined;
  });
});

async function handleDetect(digest: PageDigest): Promise<DetectResponse> {
  const apiKey = await apiKeyItem.getValue();
  if (!apiKey) {
    return {
      ok: false,
      error: 'No Anthropic API key set. Add your key in the popup first.',
    };
  }
  try {
    const rules = await detectElementsToHide(apiKey, digest);
    return { ok: true, rules };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
