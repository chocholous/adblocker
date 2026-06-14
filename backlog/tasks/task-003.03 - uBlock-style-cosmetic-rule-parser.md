---
id: TASK-003.03
title: uBlock-style cosmetic rule parser
status: Done
assignee:
  - '@claude'
created_date: '2026-06-14 15:40'
updated_date: '2026-06-14 15:46'
labels:
  - phase-2
dependencies: []
parent_task_id: TASK-003
ordinal: 6013
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Foundation for uBlock/EasyList cosmetic syntax. Parse generic and domain-scoped cosmetic rules (##selector, domain##selector, exceptions #@#) into per-hostname selectors, including at least one procedural selector plain CSS cannot express. Self-contained module + tests; engine integration is a follow-up.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A parser turns uBO/EasyList cosmetic syntax (incl. domain scoping + a procedural selector beyond plain CSS) into the correct per-hostname selector set, unit-tested
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a pure, dependency-free uBlock/EasyList cosmetic-filter parser in lib/filterlist.ts plus tests in tests/filterlist.test.ts. Engine integration into content scripts/settings is a deliberate follow-up.

Changes:
- parseCosmeticFilters(text): parses generic (##sel), domain-scoped (example.com##sel), multi-domain (a.com,b.com##sel), negated (~sub##sel), and exception/unhide (#@#sel) rules; ignores comments (!), [..] headers, blank lines, and network filters.
- Procedural selectors: parses uBO :has-text(...) / :contains(...) and :has(...) into a structured { css, procedural: [{ type, arg }] } form (nested parens preserved, quotes stripped) so a runtime can evaluate text-based matching that plain CSS cannot.
- selectorsForHostname(rules, hostname): resolves generic + matching domain-scoped rules with subdomain inheritance (example.com applies to www.example.com, anchored at label boundary), applies negated-domain exclusions, subtracts #@# exceptions, and returns css[] and procedural[] separately.

Tests: tests/filterlist.test.ts (30 total in suite, all green) covering generic vs scoped, multi-domain, subdomain inheritance, negated domains, #@# exceptions, comment/blank handling, procedural parsing, and a verdict test showing :has-text selects by text where plain CSS over-selects.

Gate: npm run gate passes. No dependencies added.
<!-- SECTION:FINAL_SUMMARY:END -->
