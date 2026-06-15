import { describe, it, expect, beforeEach, vi } from 'vitest';
import { storage } from 'wxt/utils/storage';
import { __test } from '../lib/consent';
import { settingsItem, DEFAULT_SETTINGS } from '../lib/settings';

const {
  handleOnce,
  restoreScrolling,
  isConsentContext,
  isHideableWall,
  wouldBlankPage,
} = __test;

/** Reset the document body between tests for isolation. */
beforeEach(() => {
  document.documentElement.removeAttribute('style');
  document.documentElement.className = '';
  document.body.innerHTML = '';
  document.body.removeAttribute('style');
  document.body.className = '';
});

describe('consent handler — reject path', () => {
  it('clicks the reject control (not accept) inside a cookie dialog', () => {
    document.body.innerHTML = `
      <div id="cmp" class="cookie-consent" role="dialog">
        <p>We value your privacy and use cookies.</p>
        <button id="accept">Accept all</button>
        <button id="reject">Reject all</button>
      </div>`;
    const accept = document.getElementById('accept') as HTMLButtonElement;
    const reject = document.getElementById('reject') as HTMLButtonElement;
    const acceptSpy = vi.fn();
    const rejectSpy = vi.fn();
    accept.addEventListener('click', acceptSpy);
    reject.addEventListener('click', rejectSpy);

    const acted = handleOnce();

    expect(acted).toBe(true);
    expect(rejectSpy).toHaveBeenCalledTimes(1);
    expect(acceptSpy).not.toHaveBeenCalled();
  });

  it('clicks a known-CMP reject selector (OneTrust)', () => {
    document.body.innerHTML = `
      <div id="onetrust-banner-sdk">
        <button id="onetrust-accept-btn-handler">Accept</button>
        <button id="onetrust-reject-all-handler">Reject</button>
      </div>`;
    const reject = document.getElementById(
      'onetrust-reject-all-handler',
    ) as HTMLButtonElement;
    const spy = vi.fn();
    reject.addEventListener('click', spy);

    expect(handleOnce()).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('clicks a Czech reject control (Odmítnout vše)', () => {
    document.body.innerHTML = `
      <div class="szn-cmp-dialog-container" role="dialog">
        <p>Souhlas s cookies</p>
        <button id="ano">Souhlasím</button>
        <button id="ne">Odmítnout vše</button>
      </div>`;
    const spy = vi.fn();
    document.getElementById('ne')!.addEventListener('click', spy);
    expect(handleOnce()).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('clicks at most once per CMP (idempotent across passes)', () => {
    document.body.innerHTML = `
      <div class="cookie-consent" role="dialog">
        <p>cookies privacy</p>
        <button id="reject">Decline</button>
      </div>`;
    const spy = vi.fn();
    document.getElementById('reject')!.addEventListener('click', spy);
    handleOnce();
    handleOnce();
    handleOnce();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('consent handler — hide + scroll-unlock fallback', () => {
  it('hides the overlay and restores scrolling when no reject control exists', () => {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.classList.add('modal-open');
    document.body.innerHTML = `
      <div id="real">real article content</div>
      <div id="cmp" class="cookie-overlay" role="dialog">
        <p>We value your privacy and use cookies.</p>
        <button id="accept">Accept all</button>
      </div>`;

    const acted = handleOnce();

    expect(acted).toBe(true);
    const cmp = document.getElementById('cmp') as HTMLElement;
    expect(cmp.style.display).toBe('none');
    // Scroll-locks lifted.
    expect(document.documentElement.style.overflow).not.toBe('hidden');
    expect(document.body.style.overflow).not.toBe('hidden');
    expect(document.body.classList.contains('modal-open')).toBe(false);
    // Real content untouched.
    const real = document.getElementById('real') as HTMLElement;
    expect(real.style.display).not.toBe('none');
  });

  it('restoreScrolling lifts position:fixed scroll-lock on body', () => {
    document.body.style.position = 'fixed';
    document.body.style.top = '-100px';
    restoreScrolling();
    expect(document.body.style.position).not.toBe('fixed');
  });
});

describe('consent handler — no-op safety (zero false positives)', () => {
  it('does nothing when there is no consent UI', () => {
    document.body.innerHTML = `
      <main id="content"><h1>Article</h1><p>Body text.</p></main>
      <button id="cta">Subscribe</button>`;
    const spy = vi.fn();
    document.getElementById('cta')!.addEventListener('click', spy);

    expect(handleOnce()).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    expect(
      (document.getElementById('content') as HTMLElement).style.display,
    ).toBe('');
  });

  it('does NOT click a "Reject" button outside any cookie/consent context', () => {
    document.body.innerHTML = `
      <form id="review">
        <h2>Submit your review</h2>
        <button id="reject">Reject suggestion</button>
        <button id="approve">Approve</button>
      </form>`;
    const spy = vi.fn();
    document.getElementById('reject')!.addEventListener('click', spy);

    expect(handleOnce()).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('does NOT hide a generic dialog with no cookie/consent signal', () => {
    document.body.innerHTML = `
      <div id="modal" class="signup-modal" role="dialog">
        <p>Create your account</p>
        <button id="close">Close</button>
      </div>`;
    expect(handleOnce()).toBe(false);
    expect(
      (document.getElementById('modal') as HTMLElement).style.display,
    ).toBe('');
  });

  it('does NOT hide tiny inline links that merely carry a consent token', () => {
    // A footer "Nastavení cookies" link (Seznam: a.atm-cmp-link) matches the
    // `cmp` token but is just a link — hiding it is a false-positive.
    document.body.innerHTML = `
      <main>real article body text goes here and is long enough</main>
      <footer>
        <a class="atm-cmp-link" href="/cmp">Nastavení cookies</a>
      </footer>`;
    const link = document.querySelector('.atm-cmp-link') as HTMLElement;
    expect(isHideableWall(link)).toBe(false);
    handleOnce();
    expect(link.style.display).not.toBe('none');
  });

  it('does NOT blank a dedicated consent page (wall is the whole page)', () => {
    // cmp.seznam.cz-style: the consent dialog IS essentially the entire page.
    // Hiding it would leave a blank white page, so we must keep it.
    document.body.innerHTML = `
      <div class="szn-cmp-dialog-container" role="dialog">
        <p>We value your privacy and use cookies. Please choose your settings.</p>
      </div>`;
    const wall = document.querySelector(
      '.szn-cmp-dialog-container',
    ) as HTMLElement;
    expect(wouldBlankPage(wall)).toBe(true);
    handleOnce();
    // Kept visible (not display:none) because hiding would blank the page.
    expect(wall.style.display).not.toBe('none');
    expect(wall.getAttribute('data-sch-consent')).toBe('kept');
  });

  it('isConsentContext is true only for cookie/consent-ish nodes', () => {
    document.body.innerHTML = `
      <div id="a" class="cookie-banner"></div>
      <div id="b" class="newsletter"></div>
      <div id="c" role="dialog">we value your privacy / cookies</div>`;
    expect(isConsentContext(document.getElementById('a'))).toBe(true);
    expect(isConsentContext(document.getElementById('b'))).toBe(false);
    expect(isConsentContext(document.getElementById('c'))).toBe(true);
  });
});

describe('settings migration v2 -> v3', () => {
  beforeEach(async () => {
    await storage.clear('sync');
  });

  it('backfills dismissConsent:true and preserves existing fields', async () => {
    // Seed raw storage exactly as a v2 install would look: a value plus meta {v:2}.
    await storage.setItem('sync:settings', {
      enabled: false,
      hideSelectors: ['.legacy'],
      removeSelectors: ['.gone'],
      spoofAntiAdblock: false,
      cosmeticFilters: 'example.com##.x',
    });
    await storage.setMeta('sync:settings', { v: 2 });

    await settingsItem.migrate();

    const migrated = await settingsItem.getValue();
    expect(migrated.dismissConsent).toBe(true);
    // All previously-stored fields are preserved unchanged.
    expect(migrated.enabled).toBe(false);
    expect(migrated.hideSelectors).toEqual(['.legacy']);
    expect(migrated.removeSelectors).toEqual(['.gone']);
    expect(migrated.spoofAntiAdblock).toBe(false);
    expect(migrated.cosmeticFilters).toBe('example.com##.x');
  });

  it('DEFAULT_SETTINGS enables consent dismissal by default', () => {
    expect(DEFAULT_SETTINGS.dismissConsent).toBe(true);
  });
});
