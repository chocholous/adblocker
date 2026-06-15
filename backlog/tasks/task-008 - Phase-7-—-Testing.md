---
id: TASK-008
title: Phase 7 — Testing
status: Done
assignee: []
created_date: '2026-06-14 12:45'
updated_date: '2026-06-15 10:01'
labels:
  - phase-7
  - testing
dependencies:
  - TASK-001
ordinal: 7
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Expand coverage: unit, integration, E2E, manual matrix. Unit/integration + first E2E already shipped.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 npm test green; >=1 Playwright E2E loads the extension and asserts a hide
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Testing in place: vitest (81 unit/integration via happy-dom) + Playwright e2e loading the built extension (multiple specs) + the validation harness (validation/run.mjs over a 62/30 corpus). CI runs gate + e2e on every push/PR.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 All quality gates green (npm run gate)
- [ ] #2 Docs updated if behavior changed
<!-- DOD:END -->
