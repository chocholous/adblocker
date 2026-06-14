import Anthropic from '@anthropic-ai/sdk';
import { filterToAllowedSelectors } from './detect';
import type { PageDigest, DetectedRule } from './detect';

/**
 * On-demand page-cleanup detection with Claude Haiku.
 *
 * This is NOT a runtime path — it runs only when the user explicitly asks to
 * clean up the current page. Haiku is the fastest/cheapest Claude model
 * (`claude-haiku-4-5`); even so, we send a small structural digest, never the
 * whole page, and we constrain the output to a JSON schema.
 */

const SYSTEM = `You are a web decluttering assistant. You receive a JSON digest of candidate elements on a web page the user wants to clean up. Each candidate has a unique CSS selector in its "sel" field, plus tag, id, classes, role, aria label, a short text snippet, and its on-screen rectangle [x, y, width, height].

Select the candidates that are clutter the user would want hidden: advertisements, sponsored or promoted blocks, cookie/consent banners, newsletter or subscription pop-ups and walls, social share/follow widgets, "related"/"recommended" content spam, floating overlays, and similar noise.

Do NOT hide primary content: the main article or product, primary navigation the user needs, search boxes, or the page's core purpose.

Rules:
- Only return selectors copied EXACTLY from the "sel" field of a candidate. Never invent or modify a selector.
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

export async function detectElementsToHide(
  apiKey: string,
  digest: PageDigest,
): Promise<DetectedRule[]> {
  const client = new Anthropic({
    apiKey,
    // Required to run the SDK outside Node. We are in the extension service
    // worker (extension origin), not a page, so the key is not exposed to sites.
    dangerouslyAllowBrowser: true,
    defaultHeaders: {
      'anthropic-dangerous-direct-browser-access': 'true',
    },
  });

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1500,
    system: SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(digest) }],
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
  // never inject an arbitrary selector that hides real content.
  const allowed = new Set(digest.nodes.map((n) => n.sel));
  return filterToAllowedSelectors(parsed.rules ?? [], allowed);
}
