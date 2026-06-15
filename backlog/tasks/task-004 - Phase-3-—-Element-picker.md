---
id: TASK-004
title: Phase 3 — Element picker
status: Done
assignee:
  - '@claude'
created_date: '2026-06-14 12:45'
updated_date: '2026-06-15 10:17'
labels:
  - phase-3
  - ux
dependencies:
  - TASK-002
ordinal: 3
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Click-to-hide overlay in a closed Shadow DOM; generate a robust selector.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 User picks an element with no CSS knowledge and it is permanently hidden
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Pure buildSelector(el) in lib/picker.ts (unique id > stable tag+class combo > bounded nth-of-type path)
2. Closed-shadow-DOM interactive picker: hover highlight box, click select, confirm toolbar with live preview, Esc cancel, Undo
3. persistSelector appends to settings.hideSelectors (dedupe)
4. sch:startPicker message in lib/detect.ts; content.ts handles it (top frame only)
5. Popup 'Pick element to hide' button -> tabs.sendMessage + window.close
6. Unit tests tests/picker.test.ts; e2e e2e/picker.spec.ts
7. Gate + e2e + clean-FP validation
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Phase 3 element picker: point-and-click element hiding for non-technical users.

What changed:
- lib/picker.ts: pure buildSelector(el) (unique #id > stable tag+class combo, filtering hashed/CSS-module/styled-components/utility/dynamic classes, verified unique via querySelectorAll length===1 > bounded :nth-of-type ancestor path). Interactive picker rendered into a CLOSED Shadow DOM host on documentElement (page cannot style/read/detect it) with hover highlight box, click select, confirm toolbar + live hide preview, Esc cancel, and an Undo after Hide. persistSelector appends to settings.hideSelectors (deduped) so the existing hider keeps it hidden across reloads/restart. Fully defensive and idempotent.
- lib/detect.ts: added sch:startPicker to RuntimeMessage.
- entrypoints/content.ts: handle sch:startPicker (top frame only) -> startPicker().
- entrypoints/popup: 'Pick element to hide' button sends sch:startPicker to the active tab via browser.tabs.sendMessage and closes the popup.

User impact: a user with no CSS knowledge can pick an element and have it permanently hidden.

Tests:
- tests/picker.test.ts (vitest/happy-dom): buildSelector id/class-combo/nth-of-type cases, dynamic-class filtering, non-unique-id skip, persist dedupe.
- e2e/picker.spec.ts: trigger picker, select element, confirm Hide, assert hidden + persisted to settings + survives reload.

Gates: npm run gate green (format/lint/compile/88 unit tests/build). E2E 9/9 passed. Clean-FP validation (full --only=clean): 29/30 reachable, 0 false-positives (1 unreachable = egress proxy, not a regression).
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 All quality gates green (npm run gate)
- [x] #2 Docs updated if behavior changed
<!-- DOD:END -->
