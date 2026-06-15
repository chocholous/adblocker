---
id: TASK-016
title: Consent wall handling (reject or hide)
status: Done
assignee:
  - '@claude'
created_date: '2026-06-14 20:13'
updated_date: '2026-06-15 10:01'
labels:
  - engine
dependencies: []
ordinal: 10013
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Always reject consent/CMP walls; hide + unlock scroll as fallback. Zero false-positives.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Consent walls are rejected when possible, else hidden with scrolling restored; no clean-site false-positives; gate+e2e green
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Build lib/consent.ts: reject-first (CMP selectors + scoped text heuristic), hide+scroll-unlock fallback, time-bounded MutationObserver, fully try/catch.
2. Add dismissConsent setting (default true), bump settingsItem to v3 with lossless migration; update parse/serialize + popup.
3. Wire into entrypoints/content.ts (top frame, defensive).
4. Unit tests tests/consent.test.ts; e2e e2e/consent.spec.ts.
5. gate + e2e + clean-corpus FP=0.
<!-- SECTION:PLAN:END -->
