import { describe, it, expect, beforeEach } from 'vitest';
import { FiltersEngine } from '@ghostery/adblocker';
import { matchResources, type ResourceQuery } from '@/lib/engine';
import {
  collectResources,
  runHidePass,
  type CollectedResource,
} from '@/lib/net-hide';

/**
 * Small in-memory engine carrying NETWORK filters for a couple of well-known ad
 * hosts, so the matcher tests are deterministic and need no network.
 */
function fixtureEngine(): FiltersEngine {
  const list = [
    '! fixture network list',
    '||doubleclick.net^',
    '||googlesyndication.com^',
    '||tracker.example^',
  ].join('\n');
  return FiltersEngine.parse(list, {
    enableCompression: true,
    loadNetworkFilters: true,
  });
}

const SOURCE = 'https://news.example/article';

describe('engine network matching (matchResources)', () => {
  it('matches an ad-host resource and ignores a first-party one', () => {
    const engine = fixtureEngine();
    const items: ResourceQuery[] = [
      { id: 0, url: 'https://doubleclick.net/ad?x=1', type: 'sub_frame' },
      { id: 1, url: 'https://news.example/photo.jpg', type: 'image' },
    ];
    const matched = matchResources(engine, items, SOURCE);
    expect(matched).toEqual([0]);
  });

  it('matches multiple ad hosts in a batch', () => {
    const engine = fixtureEngine();
    const items: ResourceQuery[] = [
      { id: 10, url: 'https://news.example/x.png', type: 'image' },
      {
        id: 11,
        url: 'https://googlesyndication.com/pagead.js',
        type: 'script',
      },
      { id: 12, url: 'https://tracker.example/beacon.gif', type: 'image' },
    ];
    expect(matchResources(engine, items, SOURCE).sort()).toEqual([11, 12]);
  });

  it('never throws on a malformed URL, just skips it', () => {
    const engine = fixtureEngine();
    const items: ResourceQuery[] = [
      { id: 0, url: 'not a url', type: 'image' },
      { id: 1, url: 'https://doubleclick.net/ad', type: 'sub_frame' },
    ];
    expect(matchResources(engine, items, SOURCE)).toEqual([1]);
  });

  it('survives serialize/deserialize round-trip (network filters kept)', () => {
    const restored = FiltersEngine.deserialize(fixtureEngine().serialize());
    const items: ResourceQuery[] = [
      { id: 0, url: 'https://doubleclick.net/ad', type: 'sub_frame' },
    ];
    expect(matchResources(restored, items, SOURCE)).toEqual([0]);
  });
});

describe('collectResources', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('collects iframe/img/video/source/embed/object with the right types', () => {
    document.body.innerHTML = `
      <iframe src="https://doubleclick.net/ad"></iframe>
      <img src="/local.png">
      <video src="https://cdn.example/v.mp4"></video>
      <video><source src="https://cdn.example/s.webm"></video>
      <embed src="https://x.example/e.swf">
      <object data="https://x.example/o.pdf"></object>
      <link href="/style.css" rel="stylesheet">
    `;
    const items = collectResources(document, 'https://news.example/');
    const byType = items.map((i) => i.type).sort();
    // 1 sub_frame, 1 image, 2 media (video + source), 2 other (embed + object).
    expect(byType).toEqual([
      'image',
      'media',
      'media',
      'other',
      'other',
      'sub_frame',
    ]);
    // <link> is intentionally not collected.
    expect(items.some((i) => i.url.endsWith('style.css'))).toBe(false);
  });

  it('absolutizes relative URLs and skips data:/blob: URLs', () => {
    document.body.innerHTML = `
      <img src="/pics/a.png">
      <img src="data:image/png;base64,AAAA">
    `;
    const items = collectResources(document, 'https://news.example/sub/');
    expect(items).toHaveLength(1);
    expect(items[0]?.url).toBe('https://news.example/pics/a.png');
  });
});

/** Matcher that flags any URL whose host contains a banned ad host token. */
function adHostMatcher(...hosts: string[]) {
  return async (items: CollectedResource[]): Promise<number[]> => {
    const matched: number[] = [];
    items.forEach((item, i) => {
      if (hosts.some((h) => item.url.includes(h))) matched.push(i);
    });
    return matched;
  };
}

describe('runHidePass', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('hides an ad-sourced iframe and leaves first-party content alone', async () => {
    document.body.innerHTML = `
      <iframe id="ad" src="https://doubleclick.net/ad"></iframe>
      <iframe id="real" src="https://news.example/embed"></iframe>
      <img id="pic" src="https://news.example/photo.jpg">
    `;
    const cache = new Map<string, boolean>();
    const hidden = await runHidePass(
      document,
      'https://news.example/',
      adHostMatcher('doubleclick.net'),
      cache,
    );
    expect(hidden).toBe(1);
    const ad = document.getElementById('ad') as HTMLElement;
    const real = document.getElementById('real') as HTMLElement;
    const pic = document.getElementById('pic') as HTMLElement;
    expect(ad.style.display).toBe('none');
    expect(ad.style.getPropertyPriority('display')).toBe('important');
    expect(real.style.display).toBe('');
    expect(pic.style.display).toBe('');
  });

  it('is idempotent: a second pass hides nothing new and uses the cache', async () => {
    document.body.innerHTML = `
      <iframe id="ad" src="https://doubleclick.net/ad"></iframe>
    `;
    const cache = new Map<string, boolean>();
    let calls = 0;
    const counting = async (items: CollectedResource[]): Promise<number[]> => {
      calls += 1;
      return adHostMatcher('doubleclick.net')(items);
    };
    const first = await runHidePass(
      document,
      'https://news.example/',
      counting,
      cache,
    );
    const second = await runHidePass(
      document,
      'https://news.example/',
      counting,
      cache,
    );
    expect(first).toBe(1);
    expect(second).toBe(0);
    // Second pass: the element is marked hidden, so it isn't even collected →
    // matcher not called again.
    expect(calls).toBe(1);
  });

  it('caches a non-ad verdict so the same URL is not re-queried', async () => {
    document.body.innerHTML = `<img id="pic" src="https://news.example/a.png">`;
    const cache = new Map<string, boolean>();
    let calls = 0;
    const counting = async (): Promise<number[]> => {
      calls += 1;
      return [];
    };
    await runHidePass(document, 'https://news.example/', counting, cache);
    await runHidePass(document, 'https://news.example/', counting, cache);
    expect(cache.get('https://news.example/a.png')).toBe(false);
    // First pass queries; second sees the cached false and skips the query.
    expect(calls).toBe(1);
  });

  it('collapses a sole-child ad wrapper but never a content section', async () => {
    document.body.innerHTML = `
      <div id="wrap"><iframe id="ad" src="https://doubleclick.net/ad"></iframe></div>
      <section id="sec"><iframe id="ad2" src="https://doubleclick.net/ad2"></iframe>kept text</section>
    `;
    const cache = new Map<string, boolean>();
    await runHidePass(
      document,
      'https://news.example/',
      adHostMatcher('doubleclick.net'),
      cache,
    );
    const wrap = document.getElementById('wrap') as HTMLElement;
    const sec = document.getElementById('sec') as HTMLElement;
    // Pure wrapper (sole child, no text) collapses.
    expect(wrap.style.display).toBe('none');
    // <section> is a structural landmark with its own text: never collapsed.
    expect(sec.style.display).toBe('');
  });

  it('never throws when the matcher rejects', async () => {
    document.body.innerHTML = `<iframe src="https://doubleclick.net/ad"></iframe>`;
    const throwing = async (): Promise<number[]> => {
      throw new Error('boom');
    };
    const cache = new Map<string, boolean>();
    await expect(
      runHidePass(document, 'https://news.example/', throwing, cache),
    ).resolves.toBe(0);
  });
});
