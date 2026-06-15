import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { settingsItem, apiKeyItem, oauthTokenItem } from '@/lib/settings';
import {
  detectElementsToHide,
  type Screenshot,
  type ScreenshotMediaType,
  type DetectOptions,
} from '@/lib/anthropic';
import {
  loadEngine,
  cosmeticsForFrame,
  matchResourcesForFrame,
} from '@/lib/engine';
import type {
  BuildDigestResponse,
  CleanupRequestMessage,
  DetectResponse,
  EngineCosmeticsMessage,
  EngineCosmeticsResponse,
  MatchResourcesMessage,
  MatchResourcesResponse,
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
    if (msg?.type === 'sch:cleanupRequest') {
      return handleCleanupRequest(msg);
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

/**
 * Capture the visible tab as an image for vision mode. Returns `undefined` on
 * any failure (the caller degrades to the text-only path). `captureVisibleTab`
 * relies on the activeTab grant from the popup's user gesture.
 */
async function captureScreenshot(): Promise<Screenshot | undefined> {
  try {
    // JPEG keeps the payload small; quality is plenty for ad-region detection.
    // Single-argument form captures the current window's active visible tab.
    const dataUrl = await browser.tabs.captureVisibleTab({
      format: 'jpeg',
      quality: 70,
    });
    const match = /^data:(image\/[a-z]+);base64,(.*)$/.exec(dataUrl ?? '');
    if (!match || !match[1] || match[2] === undefined) return undefined;
    return {
      mediaType: match[1] as ScreenshotMediaType,
      data: match[2],
    };
  } catch {
    return undefined;
  }
}

/**
 * Orchestrate one AI cleanup: ask the content frame for a digest, optionally
 * capture a screenshot for vision mode, select the credential for the chosen
 * auth method, and call the model. All privileged work (capture + API call)
 * happens here in the background SW, never in the page.
 */
async function handleCleanupRequest(
  msg: CleanupRequestMessage,
): Promise<DetectResponse> {
  const settings = await settingsItem.getValue();

  // Resolve the credential for the selected auth method up front so a missing
  // credential is a clear error before we do any work.
  const credential =
    settings.aiAuthMethod === 'oauth'
      ? await oauthTokenItem.getValue()
      : await apiKeyItem.getValue();
  if (!credential) {
    return {
      ok: false,
      error:
        settings.aiAuthMethod === 'oauth'
          ? 'No Claude subscription token set. Paste your OAuth token in the popup first.'
          : 'No Anthropic API key set. Add your key in the popup first.',
    };
  }

  // Build the digest in the page's top frame.
  let digestRes: BuildDigestResponse | undefined;
  try {
    digestRes = (await browser.tabs.sendMessage(msg.tabId, {
      type: 'sch:buildDigest',
    })) as BuildDigestResponse | undefined;
  } catch {
    return {
      ok: false,
      error: "This page can't be cleaned up (no content script).",
    };
  }
  if (!digestRes?.ok) {
    return {
      ok: false,
      error: digestRes?.error ?? 'Could not analyze this page.',
    };
  }

  // Capture a screenshot only in vision mode. If capture fails, we degrade to
  // the text path rather than aborting the whole cleanup.
  const screenshot = settings.aiVision ? await captureScreenshot() : undefined;

  const options: DetectOptions = {
    authMethod: settings.aiAuthMethod,
    credential,
    model: settings.aiModel,
    screenshot,
  };

  try {
    const rules = await detectElementsToHide(options, digestRes.digest);
    return { ok: true, rules };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
