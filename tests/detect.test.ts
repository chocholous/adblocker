import { describe, it, expect } from 'vitest';
import { filterToAllowedSelectors, type DetectedRule } from '../lib/detect';

describe('filterToAllowedSelectors', () => {
  const rules: DetectedRule[] = [
    { selector: '.ad', label: 'Banner ad', category: 'ad' },
    { selector: '.evil-injected', label: 'Not in digest', category: 'other' },
  ];

  it('keeps only rules whose selector is in the allow-list', () => {
    const out = filterToAllowedSelectors(rules, new Set(['.ad', '.nav']));
    expect(out).toEqual([
      { selector: '.ad', label: 'Banner ad', category: 'ad' },
    ]);
  });

  it('drops everything when the allow-list is empty', () => {
    expect(filterToAllowedSelectors(rules, new Set())).toEqual([]);
  });
});
