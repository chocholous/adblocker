import { describe, it, expect } from 'vitest';
import {
  parseCosmeticFilters,
  selectorsForHostname,
  type ProceduralSelector,
} from '../lib/filterlist';

describe('parseCosmeticFilters', () => {
  it('ignores comments and blank lines', () => {
    const text = [
      '! This is a comment',
      '[Adblock Plus 2.0]',
      '',
      '   ',
      '##.ad',
    ].join('\n');
    const { rules } = parseCosmeticFilters(text);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      action: 'hide',
      domains: [],
      excludedDomains: [],
      selector: '.ad',
      procedural: null,
    });
  });

  it('parses generic, domain-scoped, multi-domain and negated rules', () => {
    const text = [
      '##.generic',
      'example.com##.scoped',
      'a.com,b.com##.multi',
      '~m.example.com##.negated',
    ].join('\n');
    const { rules } = parseCosmeticFilters(text);

    expect(rules[0]).toMatchObject({ domains: [], excludedDomains: [] });
    expect(rules[1]).toMatchObject({ domains: ['example.com'] });
    expect(rules[2]).toMatchObject({ domains: ['a.com', 'b.com'] });
    expect(rules[3]).toMatchObject({ excludedDomains: ['m.example.com'] });
  });

  it('parses exception (#@#) rules as unhide', () => {
    const { rules } = parseCosmeticFilters('example.com#@#.ad');
    expect(rules[0]).toMatchObject({
      action: 'unhide',
      domains: ['example.com'],
      selector: '.ad',
    });
  });

  it('skips non-cosmetic (network) filters', () => {
    const { rules } = parseCosmeticFilters('||ads.example.com^');
    expect(rules).toHaveLength(0);
  });

  it('parses :has-text(...) into a structured procedural selector', () => {
    const { rules } = parseCosmeticFilters('##div.item:has-text("Sponsored")');
    const proc = rules[0]?.procedural as ProceduralSelector;
    expect(proc).toEqual({
      css: 'div.item',
      procedural: [{ type: 'has-text', arg: 'Sponsored' }],
    });
  });

  it('treats :contains(...) as an alias of :has-text', () => {
    const { rules } = parseCosmeticFilters('##.box:contains(Ad)');
    expect(rules[0]?.procedural).toEqual({
      css: '.box',
      procedural: [{ type: 'has-text', arg: 'Ad' }],
    });
  });

  it('parses :has(...) with nested parentheses intact', () => {
    const { rules } = parseCosmeticFilters('##.card:has(.x:not(.y))');
    expect(rules[0]?.procedural).toEqual({
      css: '.card',
      procedural: [{ type: 'has', arg: '.x:not(.y)' }],
    });
  });
});

describe('selectorsForHostname', () => {
  const ruleSet = parseCosmeticFilters(
    [
      '##.generic-ad',
      'example.com##.scoped-ad',
      'a.com,b.com##.multi-ad',
      '~m.example.com##.no-mobile',
      'example.com#@#.generic-ad',
    ].join('\n'),
  );

  it('includes generic rules everywhere', () => {
    expect(selectorsForHostname(ruleSet, 'random.org').css).toContain(
      '.generic-ad',
    );
  });

  it('includes matching domain-scoped rules', () => {
    expect(selectorsForHostname(ruleSet, 'example.com').css).toContain(
      '.scoped-ad',
    );
    // Different host should not see the scoped rule.
    expect(selectorsForHostname(ruleSet, 'other.com').css).not.toContain(
      '.scoped-ad',
    );
  });

  it('resolves multi-domain rules for each listed domain', () => {
    expect(selectorsForHostname(ruleSet, 'a.com').css).toContain('.multi-ad');
    expect(selectorsForHostname(ruleSet, 'b.com').css).toContain('.multi-ad');
    expect(selectorsForHostname(ruleSet, 'c.com').css).not.toContain(
      '.multi-ad',
    );
  });

  it('applies a parent-domain rule on subdomains (inheritance)', () => {
    expect(selectorsForHostname(ruleSet, 'www.example.com').css).toContain(
      '.scoped-ad',
    );
  });

  it('does not match a different domain that merely ends in the same string', () => {
    expect(selectorsForHostname(ruleSet, 'notexample.com').css).not.toContain(
      '.scoped-ad',
    );
  });

  it('excludes negated domains while applying elsewhere', () => {
    expect(selectorsForHostname(ruleSet, 'desktop.site').css).toContain(
      '.no-mobile',
    );
    expect(selectorsForHostname(ruleSet, 'm.example.com').css).not.toContain(
      '.no-mobile',
    );
  });

  it('subtracts #@# exceptions for the matching host', () => {
    // generic-ad is unhidden on example.com via #@#, kept elsewhere.
    expect(selectorsForHostname(ruleSet, 'example.com').css).not.toContain(
      '.generic-ad',
    );
    expect(selectorsForHostname(ruleSet, 'other.com').css).toContain(
      '.generic-ad',
    );
  });

  it('separates procedural selectors from plain CSS', () => {
    const procSet = parseCosmeticFilters('##.feed > div:has-text("Promoted")');
    const resolved = selectorsForHostname(procSet, 'social.example');
    expect(resolved.css).toEqual([]);
    expect(resolved.procedural).toEqual([
      {
        css: '.feed > div',
        procedural: [{ type: 'has-text', arg: 'Promoted' }],
      },
    ]);
  });
});

describe('procedural selectors express what plain CSS cannot', () => {
  /**
   * A `:has-text` rule selects an element by its text content. Plain CSS has no
   * way to express "an element whose text is X", so `querySelectorAll` on the
   * CSS prefix alone cannot reproduce the verdict — proving the procedural step
   * is load-bearing. We model the runtime evaluation here against a tiny DOM.
   */
  function evaluateHasText(
    nodes: { text: string }[],
    proc: ProceduralSelector,
  ): { text: string }[] {
    return nodes.filter((n) =>
      proc.procedural.every(
        (op) => op.type === 'has-text' && n.text.includes(op.arg),
      ),
    );
  }

  it('matches by text content where CSS would over-select', () => {
    const { rules } = parseCosmeticFilters('##.post:has-text("Sponsored")');
    const proc = rules[0]!.procedural!;

    const dom = [{ text: 'Sponsored: buy now' }, { text: 'A genuine post' }];

    // Plain CSS (".post") would match BOTH nodes — it cannot read text.
    expect(dom).toHaveLength(2);

    // The procedural step narrows it to only the sponsored node.
    const hidden = evaluateHasText(dom, proc);
    expect(hidden).toEqual([{ text: 'Sponsored: buy now' }]);
  });
});
