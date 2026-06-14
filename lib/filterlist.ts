/**
 * uBlock Origin / EasyList COSMETIC filter parser.
 *
 * This module turns the textual cosmetic-filter syntax used by uBO and EasyList
 * into a structured rule set, and resolves the applicable selectors for a given
 * hostname. It is intentionally framework-agnostic and side-effect free (pure
 * functions only, no DOM access), so a runtime engine can consume the output and
 * it stays trivially unit-testable.
 *
 * Supported cosmetic syntax
 * -------------------------
 *  - Generic hide:            `##selector`
 *  - Domain-scoped hide:      `example.com##selector`
 *  - Multi-domain hide:       `a.com,b.com##selector`
 *  - Negated domain:          `~sub.example.com##selector` (apply everywhere EXCEPT)
 *  - Exception / unhide:      `example.com#@#selector`  (removes a selector for a host)
 *  - Comments (`!`) and blank lines are ignored.
 *
 * Procedural selectors
 * --------------------
 * uBO extends CSS with "procedural" operators that plain
 * `document.querySelectorAll` cannot evaluate. We parse at least:
 *  - `:has-text(...)` / `:contains(...)` — match an element by its text content.
 *  - `:has(...)`                          — match an element that contains a descendant.
 *
 * These are parsed into a structured {@link ProceduralSelector} so a runtime
 * engine can later evaluate them step by step. Matching an element by its text
 * content (`:has-text`) is fundamentally impossible with a single CSS selector,
 * which is the whole point of the procedural form.
 */

/** A single procedural operation extracted from a uBO procedural selector. */
export interface ProceduralOperation {
  /** Operation kind. `has-text` covers both `:has-text()` and `:contains()`. */
  type: 'has-text' | 'has';
  /** The (unquoted, where applicable) argument of the operation. */
  arg: string;
}

/**
 * A parsed procedural selector: the leading plain-CSS prefix plus the ordered
 * list of procedural operations that a runtime must apply on top of it.
 */
export interface ProceduralSelector {
  /**
   * The plain-CSS portion that a runtime can pass to `querySelectorAll`.
   * Empty string means "start from every element" (rare, but valid).
   */
  css: string;
  /** Ordered procedural operations to apply to the CSS-matched candidates. */
  procedural: ProceduralOperation[];
}

/** Action a cosmetic rule performs. */
export type CosmeticAction = 'hide' | 'unhide';

/**
 * A single parsed cosmetic rule.
 *
 * `domains` / `excludedDomains` are derived from the option list before `##`:
 *  - `example.com##x`          -> domains: ['example.com']
 *  - `a.com,b.com##x`          -> domains: ['a.com', 'b.com']
 *  - `~m.example.com##x`       -> excludedDomains: ['m.example.com']
 *  - `##x`                     -> generic (both lists empty)
 */
export interface CosmeticRule {
  action: CosmeticAction;
  /** Positive domain scopes; empty means the rule is generic. */
  domains: string[];
  /** Negated domain scopes (`~domain`); the rule never applies on these. */
  excludedDomains: string[];
  /** The raw selector text after the separator (`##`, `#@#`). */
  selector: string;
  /**
   * Structured procedural form when the selector uses uBO procedural operators,
   * otherwise `null` for plain CSS selectors.
   */
  procedural: ProceduralSelector | null;
}

/** The complete parsed rule set returned by {@link parseCosmeticFilters}. */
export interface CosmeticRuleSet {
  rules: CosmeticRule[];
}

/** Selectors resolved for a specific hostname by {@link selectorsForHostname}. */
export interface ResolvedSelectors {
  /** Plain-CSS selectors safe to pass to `querySelectorAll` / a stylesheet. */
  css: string[];
  /** Procedural selectors a runtime must evaluate beyond plain CSS. */
  procedural: ProceduralSelector[];
}

/** Procedural operators we recognise, mapped to their structured type. */
const PROCEDURAL_OPERATORS: Record<string, ProceduralOperation['type']> = {
  'has-text': 'has-text',
  contains: 'has-text',
  has: 'has',
};

/**
 * Returns true when the selector text contains a procedural operator we parse.
 * We look for `:operator(` so we don't misfire on, say, an attribute value.
 */
function looksProcedural(selector: string): boolean {
  return Object.keys(PROCEDURAL_OPERATORS).some((op) =>
    selector.includes(`:${op}(`),
  );
}

/**
 * Strip a single pair of matching surrounding quotes from a procedural argument.
 * uBO allows `:has-text("foo")`, `:has-text('foo')`, or bare `:has-text(foo)`.
 */
function unquote(arg: string): string {
  const trimmed = arg.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

/**
 * Parse a selector string into a {@link ProceduralSelector}.
 *
 * The parser walks the string once. Anything before the first recognised
 * procedural operator becomes the CSS prefix; each `:op(...)` is then peeled off
 * in order. We track parenthesis depth so nested parentheses inside an argument
 * (e.g. `:has(.x:not(.y))`) are kept intact.
 */
function parseProcedural(selector: string): ProceduralSelector {
  const operations: ProceduralOperation[] = [];
  let css = '';
  let i = 0;

  while (i < selector.length) {
    // Try to match a procedural operator at the current position.
    const opName = matchOperatorAt(selector, i);
    if (opName) {
      const openParen = i + opName.length + 1; // skip ":op"
      // openParen points at "(". Find the matching ")".
      const close = findMatchingParen(selector, openParen);
      if (close !== -1) {
        const rawArg = selector.slice(openParen + 1, close);
        operations.push({
          type: PROCEDURAL_OPERATORS[opName]!,
          arg: unquote(rawArg),
        });
        i = close + 1;
        continue;
      }
    }
    css += selector[i];
    i += 1;
  }

  return { css: css.trim(), procedural: operations };
}

/**
 * If a recognised procedural operator (`:op(`) starts at index `i`, return its
 * bare name (without the leading colon); otherwise return null.
 */
function matchOperatorAt(selector: string, i: number): string | null {
  if (selector[i] !== ':') return null;
  for (const op of Object.keys(PROCEDURAL_OPERATORS)) {
    if (selector.startsWith(op, i + 1) && selector[i + 1 + op.length] === '(') {
      return op;
    }
  }
  return null;
}

/**
 * Given the index of an opening `(`, return the index of its matching `)`,
 * honouring nested parentheses. Returns -1 if unbalanced.
 */
function findMatchingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Parse the comma-separated domain option list that precedes a `##`/`#@#`
 * separator into positive and negated domain scopes.
 */
function parseDomainOptions(options: string): {
  domains: string[];
  excludedDomains: string[];
} {
  const domains: string[] = [];
  const excludedDomains: string[] = [];
  if (options.length === 0) return { domains, excludedDomains };

  for (const raw of options.split(',')) {
    const domain = raw.trim().toLowerCase();
    if (domain.length === 0) continue;
    if (domain.startsWith('~')) {
      const negated = domain.slice(1);
      if (negated.length > 0) excludedDomains.push(negated);
    } else {
      domains.push(domain);
    }
  }
  return { domains, excludedDomains };
}

/**
 * Parse a single non-empty, non-comment line into a {@link CosmeticRule}, or
 * return null when the line is not a cosmetic rule we understand.
 *
 * Separator detection: `#@#` (exception) is checked before `##` (hide) because
 * `#@#` also contains `##`-like characters and must take precedence.
 */
function parseLine(line: string): CosmeticRule | null {
  const exceptionIdx = line.indexOf('#@#');
  const hideIdx = line.indexOf('##');

  let action: CosmeticAction;
  let sepIdx: number;
  let sepLen: number;

  if (exceptionIdx !== -1 && (hideIdx === -1 || exceptionIdx < hideIdx)) {
    action = 'unhide';
    sepIdx = exceptionIdx;
    sepLen = 3;
  } else if (hideIdx !== -1) {
    action = 'hide';
    sepIdx = hideIdx;
    sepLen = 2;
  } else {
    return null; // Not a cosmetic rule (e.g. a network filter).
  }

  const options = line.slice(0, sepIdx);
  const selector = line.slice(sepIdx + sepLen).trim();
  if (selector.length === 0) return null;

  const { domains, excludedDomains } = parseDomainOptions(options);
  const procedural = looksProcedural(selector)
    ? parseProcedural(selector)
    : null;

  return { action, domains, excludedDomains, selector, procedural };
}

/**
 * Parse a block of uBO/EasyList cosmetic-filter text into a structured rule set.
 *
 * Lines that are blank, whitespace-only, or comments (`!` or `[` headers) are
 * ignored, as are non-cosmetic (network) filters.
 */
export function parseCosmeticFilters(text: string): CosmeticRuleSet {
  const rules: CosmeticRule[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    // `!` is the EasyList comment marker; `[` starts a metadata header
    // (e.g. `[Adblock Plus 2.0]`).
    if (line.startsWith('!') || line.startsWith('[')) continue;

    const rule = parseLine(line);
    if (rule) rules.push(rule);
  }
  return { rules };
}

/**
 * Returns true when `hostname` is `domain` or a subdomain of it, so a rule
 * scoped to `example.com` also applies on `www.example.com`. Matching is
 * case-insensitive and anchored at a label boundary (so `notexample.com` does
 * NOT match `example.com`).
 */
function hostMatchesDomain(hostname: string, domain: string): boolean {
  if (hostname === domain) return true;
  return hostname.endsWith(`.${domain}`);
}

/**
 * Resolve the cosmetic selectors that apply to a hostname.
 *
 * Inclusion logic per rule:
 *  - Generic rules (no positive domains) apply everywhere.
 *  - Domain-scoped rules apply when the hostname matches one of the positive
 *    domains (with subdomain inheritance).
 *  - A rule is dropped if the hostname matches any of its negated domains.
 *
 * Then every `#@#` exception selector active for the hostname is subtracted from
 * the hide set (by exact selector text), mirroring uBO's unhide semantics.
 *
 * The result separates plain-CSS selectors from procedural ones so a runtime can
 * inject the former as a stylesheet and evaluate the latter explicitly.
 */
export function selectorsForHostname(
  ruleSet: CosmeticRuleSet,
  hostname: string,
): ResolvedSelectors {
  const host = hostname.trim().toLowerCase();

  const applies = (rule: CosmeticRule): boolean => {
    if (rule.excludedDomains.some((d) => hostMatchesDomain(host, d))) {
      return false;
    }
    if (rule.domains.length === 0) return true; // generic
    return rule.domains.some((d) => hostMatchesDomain(host, d));
  };

  // Collect active exception selectors first so we can subtract them.
  const exceptions = new Set<string>();
  for (const rule of ruleSet.rules) {
    if (rule.action === 'unhide' && applies(rule)) {
      exceptions.add(rule.selector);
    }
  }

  const css: string[] = [];
  const procedural: ProceduralSelector[] = [];
  const seenCss = new Set<string>();

  for (const rule of ruleSet.rules) {
    if (rule.action !== 'hide') continue;
    if (!applies(rule)) continue;
    if (exceptions.has(rule.selector)) continue;

    if (rule.procedural) {
      procedural.push(rule.procedural);
    } else if (!seenCss.has(rule.selector)) {
      seenCss.add(rule.selector);
      css.push(rule.selector);
    }
  }

  return { css, procedural };
}
