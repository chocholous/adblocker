import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';
import { filterToAllowedSelectors } from './detect';
import type { PageDigest, DetectedRule } from './detect';
import { AI_MODEL_IDS, type AiAuthMethod, type AiModelTier } from './settings';

/**
 * On-demand page-cleanup detection with Claude.
 *
 * This is NOT a runtime path — it runs only when the user explicitly asks to
 * clean up the current page. We send a small structural digest (and, in vision
 * mode, a screenshot), never the whole page, and constrain the output to a JSON
 * schema. Returned selectors are allow-listed against the digest before use, so
 * the model can only ever pick from elements already present on the page.
 *
 * Two authentication methods are supported (user's choice, credentials stored
 * locally only):
 *   - `apiKey` — a BYO Anthropic API key, sent as `x-api-key`.
 *   - `oauth`  — a Claude subscription OAuth access token, sent as
 *     `Authorization: Bearer <token>` with the `anthropic-beta: oauth-...` header
 *     the API requires for OAuth credentials.
 */

/**
 * Beta header value required when authenticating `/v1/messages` with a Claude
 * subscription OAuth token (as opposed to an API key).
 */
export const OAUTH_BETA = 'oauth-2025-04-20';

/** Header required to call the SDK from a non-Node (extension) origin. */
const DIRECT_BROWSER_HEADER = 'anthropic-dangerous-direct-browser-access';

const TEXT_SYSTEM = `You are a web decluttering assistant. You receive a JSON digest of candidate elements on a web page the user wants to clean up. Each candidate has a unique CSS selector in its "sel" field, plus tag, id, classes, role, aria label, a short text snippet, and its on-screen rectangle [x, y, width, height].

Select the candidates that are clutter the user would want hidden: advertisements, sponsored or promoted blocks, cookie/consent banners, newsletter or subscription pop-ups and walls, social share/follow widgets, "related"/"recommended" content spam, floating overlays, and similar noise.

Do NOT hide primary content: the main article or product, primary navigation the user needs, search boxes, or the page's core purpose.

Rules:
- Only return selectors copied EXACTLY from the "sel" field of a candidate. Never invent or modify a selector.
- Prefer the smallest set that removes the clutter without touching real content.
- Give each selection a short human-readable label and a category.`;

const VISION_SYSTEM = `You are a web decluttering assistant. You receive a screenshot of the visible page AND a JSON digest of candidate elements. Each candidate has a unique CSS selector in its "sel" field plus its on-screen rectangle [x, y, width, height] in CSS pixels. The screenshot is the same viewport; multiply CSS coordinates by "dpr" to map them to image pixels.

Use the screenshot to SEE which regions are advertisements, sponsored/native/promoted content, cookie/consent banners, newsletter or subscription pop-ups and walls, social widgets, "related"/"recommended" spam, floating overlays, and similar noise — including first-party or native ads a text-only digest would miss. Then select the digest candidates whose rectangles cover that clutter.

Do NOT hide primary content: the main article or product, primary navigation the user needs, search boxes, or the page's core purpose.

Rules:
- Only return selectors copied EXACTLY from the "sel" field of a candidate. Never invent or modify a selector. The image only informs WHICH candidates to pick — you cannot introduce a selector that is not in the digest.
- Prefer the smallest set that removes the clutter without touching real content.
- Give each selection a short human-readable label and a category.`;

// Structured-output schema. Note the constraints structured outputs support:
// enum is allowed; additionalProperties must be false; no min/max/length.
const RULES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    rules: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          selector: { type: 'string' },
          label: { type: 'string' },
          category: {
            type: 'string',
            enum: [
              'ad',
              'tracker',
              'newsletter',
              'cookie',
              'social',
              'promo',
              'clutter',
              'other',
            ],
          },
        },
        required: ['selector', 'label', 'category'],
      },
    },
  },
  required: ['rules'],
};

/** Supported screenshot image media types (from `chrome.tabs.captureVisibleTab`). */
export type ScreenshotMediaType = 'image/png' | 'image/jpeg' | 'image/webp';

/** A captured screenshot, decomposed into the fields an image block needs. */
export interface Screenshot {
  /** Base64 image data WITHOUT the `data:...;base64,` prefix. */
  data: string;
  mediaType: ScreenshotMediaType;
}

/** Credential + selected behavior for one detection call. */
export interface DetectOptions {
  authMethod: AiAuthMethod;
  /** The credential string for the selected `authMethod`. */
  credential: string;
  model: AiModelTier;
  /** Optional screenshot for vision mode. When present, the vision path is used. */
  screenshot?: Screenshot;
}

/**
 * Build the `@anthropic-ai/sdk` client constructor options for a given auth
 * method + credential. Pure (no SDK call) so the header construction is
 * unit-testable: apiKey → `x-api-key` only; oauth → `authToken` (Bearer) plus
 * the oauth beta header, never `x-api-key`.
 *
 * Throws a clear error when the selected method has no credential.
 */
export function buildClientOptions(
  authMethod: AiAuthMethod,
  credential: string,
): ClientOptions {
  const cred = credential.trim();
  // We are in the extension's own origin (service worker), not a page, so the
  // credential is never exposed to web content.
  const base = { dangerouslyAllowBrowser: true } as const;

  if (authMethod === 'oauth') {
    if (!cred) {
      throw new Error(
        'No Claude subscription token set. Paste your OAuth token in the popup first.',
      );
    }
    return {
      ...base,
      // Bearer auth. With no `apiKey` set, the SDK sends only `Authorization`.
      authToken: cred,
      defaultHeaders: {
        [DIRECT_BROWSER_HEADER]: 'true',
        'anthropic-beta': OAUTH_BETA,
      },
    };
  }

  if (!cred) {
    throw new Error(
      'No Anthropic API key set. Add your key in the popup first.',
    );
  }
  return {
    ...base,
    apiKey: cred,
    defaultHeaders: {
      [DIRECT_BROWSER_HEADER]: 'true',
    },
  };
}

/**
 * Build the user-turn message content for a detection request. Text mode sends
 * just the digest JSON; vision mode prepends the screenshot as an image block so
 * the multimodal model can see the rendered page.
 */
export function buildUserContent(
  digest: PageDigest,
  screenshot?: Screenshot,
): Anthropic.MessageParam['content'] {
  const digestJson = JSON.stringify(digest);
  if (!screenshot) return digestJson;
  return [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: screenshot.mediaType,
        data: screenshot.data,
      },
    },
    { type: 'text', text: digestJson },
  ];
}

export async function detectElementsToHide(
  options: DetectOptions,
  digest: PageDigest,
): Promise<DetectedRule[]> {
  const client = new Anthropic(
    buildClientOptions(options.authMethod, options.credential),
  );

  const useVision = !!options.screenshot;
  const response = await client.messages.create({
    model: AI_MODEL_IDS[options.model],
    max_tokens: 1500,
    system: useVision ? VISION_SYSTEM : TEXT_SYSTEM,
    messages: [
      { role: 'user', content: buildUserContent(digest, options.screenshot) },
    ],
    // output_config is GA; cast because the installed SDK's types may lag it.
    output_config: { format: { type: 'json_schema', schema: RULES_SCHEMA } },
  } as Anthropic.MessageCreateParamsNonStreaming);

  let text = '{"rules":[]}';
  for (const block of response.content) {
    if (block.type === 'text') {
      text = block.text;
      break;
    }
  }

  const parsed = JSON.parse(text) as { rules?: DetectedRule[] };

  // Safety net: only keep selectors the model copied from the digest, so it can
  // never inject an arbitrary selector that hides real content. Holds for the
  // vision path too — the image only informs the choice; selectors can't be
  // invented.
  const allowed = new Set(digest.nodes.map((n) => n.sel));
  return filterToAllowedSelectors(parsed.rules ?? [], allowed);
}
