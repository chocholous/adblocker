import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { settingsItem, apiKeyItem } from '@/lib/settings';
import { detectElementsToHide } from '@/lib/anthropic';
import {
  loadEngine,
  cosmeticsForFrame,
  matchResourcesForFrame,
} from '@/lib/engine';
import type {
  DetectResponse,
  EngineCosmeticsMessage,
  EngineCosmeticsResponse,
  MatchResourcesMessage,
  MatchResourcesResponse,
  PageDigest,
  RuntimeMessage,
} from '@/lib/detect';

/**
 * The MV3 service worker. Seeds default settings on install, owns the heavy
 * filter ENGINE (loaded once here, queried by content frames over the message
 * bus), and handles the one privileged operation that must not run in a page
 * context: calling the Anthropic API for on-demand cleanup.
 */
export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async () => {
    const current = await settingsItem.getValue();
    await settingsItem.setValue(current);
  });

  // Warm the engine eagerly so the first frame's cosmetics request is fast.
  void loadEngine();

  browser.runtime.onMessage.addListener((message: unknown) => {
    const msg = message as RuntimeMessage | undefined;
    if (msg?.type === 'sch:detect') {
      return handleDetect(msg.digest);
    }
    if (msg?.type === 'sch:engineCosmetics') {
      return handleEngineCosmetics(msg);
    }
    if (msg?.type === 'sch:matchResources') {
      return handleMatchResources(msg);
    }
    // Returning undefined lets other listeners (e.g. in content scripts) respond.
    return undefined;
  });
});

/**
 * Match a batch of resource URLs against the engine's NETWORK filters and reply
 * with the ids that an ad/tracker filter matched. Gated on `settings.enabled`
 * and fully defensive so a frame's hide pass can never break. The content script
 * HIDES the matched elements (it never blocks the request) — see lib/engine.ts.
 */
async function handleMatchResources(
  msg: MatchResourcesMessage,
): Promise<MatchResourcesResponse> {
  try {
    const settings = await settingsItem.getValue();
    if (!settings.enabled) return { matched: [] };
    const matched = await matchResourcesForFrame(msg.items, msg.sourceUrl);
    return { matched };
  } catch {
    return { matched: [] };
  }
}

/** Resolve a frame's engine cosmetics; never rejects so the frame can degrade. */
async function handleEngineCosmetics(
  msg: EngineCosmeticsMessage,
): Promise<EngineCosmeticsResponse> {
  try {
    const settings = await settingsItem.getValue();
    if (!settings.enabled) return { styles: '', scripts: [] };
    return await cosmeticsForFrame(
      msg.url,
      msg.hostname,
      msg.domain,
      msg.hints,
    );
  } catch {
    return { styles: '', scripts: [] };
  }
}

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
