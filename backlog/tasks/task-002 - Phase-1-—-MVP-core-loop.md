---
id: TASK-002
title: Phase 1 — MVP core loop
status: Done
assignee:
  - '@claude'
created_date: '2026-06-14 12:45'
updated_date: '2026-06-14 15:10'
labels:
  - phase-1
  - core
dependencies:
  - TASK-001
ordinal: 1
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Hide/remove works on real sites and persists; icons; harden ISOLATED<->MAIN handshake.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Add a selector in the popup, reload a page -> element hidden and stays hidden across navigation and browser restart
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
MVP core loop complete: icons shipped (002.01), ISOLATED<->MAIN handshake hardened to be load-order-independent (002.03), and cosmetic hide/remove validated on 3 real sites with persistence across navigation (002.02). Selector add via popup -> stored in chrome.storage.sync (persists across restart by design) -> applied at document_start. Gate + e2e green.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 All quality gates green (npm run gate)
- [x] #2 Docs updated if behavior changed
<!-- DOD:END -->
