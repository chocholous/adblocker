---
id: TASK-003.02
title: Harden element removal on SPA/React pages
status: Done
assignee:
  - '@claude'
created_date: '2026-06-14 15:40'
updated_date: '2026-06-14 15:45'
labels:
  - phase-2
dependencies: []
parent_task_id: TASK-003
ordinal: 5013
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
el.remove() via the MutationObserver can crash React/Next apps (removeChild on a node React still tracks). Make removal safe: guard/try-catch and degrade to hiding when detach is unsafe.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Removing elements never throws/crashes on React-style pages; the hider degrades to display:none when a safe detach is not possible; covered by unit tests
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Hardened cosmetic element removal so it can never crash React/Next SPA pages.

Changes (lib/hider.ts):
- Added safeRemove(el): wraps el.remove() in try/catch; on failure degrades to display:none !important inline, with a final inner try/catch so a pathological node can never throw.
- removeWithin() and both observer branches (matches + descendant sweep) now route through safeRemove instead of calling el.remove() directly.
- Wrapped the entire MutationObserver callback in try/catch so one bad node/selector never aborts filtering for the rest of the page.
- Idempotent: re-processing an already hidden/detached node is a no-op.
- Hide path and public API unchanged.

Tests (tests/hider.test.ts): added cases for remove() throwing (degrades to display:none), dynamically-added throwing nodes via the observer, one throwing node not blocking other matches, and idempotent re-processing. Full gate (format/lint/compile/18 tests/build) green.
<!-- SECTION:FINAL_SUMMARY:END -->
