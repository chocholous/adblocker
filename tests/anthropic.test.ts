import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the constructor options and messages.create params the SDK is called
// with, without making any real network request.
const created = vi.hoisted(() => ({
  options: undefined as unknown,
  params: undefined as unknown,
  reply: '{"rules":[]}',
}));

vi.mock('@anthropic-ai/sdk', () => {
  class FakeAnthropic {
    messages: { create: (params: unknown) => Promise<unknown> };
    constructor(options: unknown) {
      created.options = options;
      this.messages = {
        create: async (params: unknown) => {
          created.params = params;
          return { content: [{ type: 'text', text: created.reply }] };
        },
      };
    }
  }
  return { default: FakeAnthropic };
});

import {
  buildClientOptions,
  buildUserContent,
  detectElementsToHide,
  OAUTH_BETA,
  type DetectOptions,
} from '../lib/anthropic';
import type { PageDigest } from '../lib/detect';

const digest: PageDigest = {
  url: 'example.com/',
  title: 'Example',
  viewport: [1280, 720],
  dpr: 2,
  nodes: [
    { sel: '.ad', tag: 'div', rect: [0, 0, 300, 250] },
    { sel: '#promo', tag: 'aside', rect: [0, 300, 300, 250] },
  ],
};

beforeEach(() => {
  created.options = undefined;
  created.params = undefined;
  created.reply = '{"rules":[]}';
});

describe('buildClientOptions — header construction', () => {
  it('apiKey method sets x-api-key (no Authorization, no oauth beta)', () => {
    const opts = buildClientOptions('apiKey', 'sk-ant-key');
    expect(opts.apiKey).toBe('sk-ant-key');
    expect(opts.authToken).toBeUndefined();
    const headers = (opts.defaultHeaders ?? {}) as Record<string, string>;
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(headers['anthropic-beta']).toBeUndefined();
  });

  it('oauth method sets authToken (Bearer) + oauth beta header, no apiKey', () => {
    const opts = buildClientOptions('oauth', 'oat-token');
    expect(opts.authToken).toBe('oat-token');
    expect(opts.apiKey).toBeUndefined();
    const headers = (opts.defaultHeaders ?? {}) as Record<string, string>;
    expect(headers['anthropic-beta']).toBe(OAUTH_BETA);
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  });

  it('trims the credential', () => {
    expect(buildClientOptions('apiKey', '  sk-ant-key  ').apiKey).toBe(
      'sk-ant-key',
    );
  });

  it('throws a clear error when the API key is missing', () => {
    expect(() => buildClientOptions('apiKey', '')).toThrow(/API key/);
    expect(() => buildClientOptions('apiKey', '   ')).toThrow(/API key/);
  });

  it('throws a clear error when the OAuth token is missing', () => {
    expect(() => buildClientOptions('oauth', '')).toThrow(/subscription token/);
  });
});

describe('buildUserContent', () => {
  it('text mode sends the digest JSON as a plain string', () => {
    const content = buildUserContent(digest);
    expect(content).toBe(JSON.stringify(digest));
  });

  it('vision mode prepends a base64 image block before the digest text', () => {
    const content = buildUserContent(digest, {
      data: 'AAAA',
      mediaType: 'image/jpeg',
    });
    expect(Array.isArray(content)).toBe(true);
    const blocks = content as unknown as Array<Record<string, unknown>>;
    expect(blocks[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' },
    });
    expect(blocks[1]).toMatchObject({
      type: 'text',
      text: JSON.stringify(digest),
    });
  });
});

describe('detectElementsToHide — model mapping & allow-list', () => {
  const apiKeyOpts: DetectOptions = {
    authMethod: 'apiKey',
    credential: 'sk-ant-key',
    model: 'haiku',
  };

  it('maps the model tier to the concrete model id', async () => {
    await detectElementsToHide({ ...apiKeyOpts, model: 'sonnet' }, digest);
    expect((created.params as { model: string }).model).toBe(
      'claude-sonnet-4-6',
    );

    await detectElementsToHide({ ...apiKeyOpts, model: 'opus' }, digest);
    expect((created.params as { model: string }).model).toBe('claude-opus-4-8');

    await detectElementsToHide({ ...apiKeyOpts, model: 'haiku' }, digest);
    expect((created.params as { model: string }).model).toBe(
      'claude-haiku-4-5',
    );
  });

  it('apiKey auth builds an x-api-key client (no Authorization)', async () => {
    await detectElementsToHide(apiKeyOpts, digest);
    const opts = created.options as Record<string, unknown>;
    expect(opts.apiKey).toBe('sk-ant-key');
    expect(opts.authToken).toBeUndefined();
  });

  it('oauth auth builds a Bearer client with the oauth beta header', async () => {
    await detectElementsToHide(
      { authMethod: 'oauth', credential: 'oat-token', model: 'haiku' },
      digest,
    );
    const opts = created.options as Record<string, unknown>;
    expect(opts.authToken).toBe('oat-token');
    expect(opts.apiKey).toBeUndefined();
    const headers = opts.defaultHeaders as Record<string, string>;
    expect(headers['anthropic-beta']).toBe(OAUTH_BETA);
  });

  it('keeps only selectors present in the digest (allow-list)', async () => {
    created.reply = JSON.stringify({
      rules: [
        { selector: '.ad', label: 'Banner', category: 'ad' },
        {
          selector: '.evil-injected',
          label: 'Not in digest',
          category: 'other',
        },
      ],
    });
    const rules = await detectElementsToHide(apiKeyOpts, digest);
    expect(rules).toEqual([
      { selector: '.ad', label: 'Banner', category: 'ad' },
    ]);
  });

  it('vision mode (screenshot present) still allow-lists returned selectors', async () => {
    created.reply = JSON.stringify({
      rules: [
        { selector: '#promo', label: 'Promo box', category: 'promo' },
        { selector: '.invented', label: 'Image-only guess', category: 'ad' },
      ],
    });
    const rules = await detectElementsToHide(
      { ...apiKeyOpts, screenshot: { data: 'AAAA', mediaType: 'image/jpeg' } },
      digest,
    );
    // The image can only inform the choice; an invented selector is rejected.
    expect(rules).toEqual([
      { selector: '#promo', label: 'Promo box', category: 'promo' },
    ]);
    // And the request actually carried the image block.
    const params = created.params as { messages: Array<{ content: unknown }> };
    expect(Array.isArray(params.messages[0]?.content)).toBe(true);
  });

  it('throws when the selected credential is missing', async () => {
    await expect(
      detectElementsToHide({ ...apiKeyOpts, credential: '' }, digest),
    ).rejects.toThrow(/API key/);
    await expect(
      detectElementsToHide(
        { authMethod: 'oauth', credential: '', model: 'haiku' },
        digest,
      ),
    ).rejects.toThrow(/subscription token/);
  });
});
