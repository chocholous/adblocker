---
id: TASK-003
title: Phase 2 — Filter engine maturity
status: Done
assignee:
  - '@claude'
created_date: '2026-06-14 12:45'
updated_date: '2026-06-14 16:00'
labels:
  - phase-2
  - engine
dependencies:
  - TASK-002
ordinal: 2
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per-domain rules + uBlock-style syntax. Reuse @ghostery/adblocker + @adguard/extended-css instead of hand-rolling.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A domain-scoped procedural rule hides an element plain CSS cannot, and survives import/export round-trip
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Integrated the cosmetic-filter engine end-to-end so domain-scoped procedural rules work and settings survive an import/export round-trip (TASK-003 AC #1).

Changes:
- lib/settings.ts: added cosmeticFilters: string to HiderSettings + DEFAULT_SETTINGS; bumped settingsItem to version 2 with a WXT migration (2: old => ...DEFAULT, ...old, cosmeticFilters: old.cosmeticFilters ?? '') so existing v1 data is preserved. Added serializeSettings/parseSettings (strict, lossless, tolerant of missing fields).
- lib/hider.ts: procedural matcher. :has-text/:contains => textContent contains arg (case-insensitive); :has => el.querySelector(arg) with JS fallback. Matches hidden via inline display:none (safeHide), re-evaluated on childList+characterData mutations; safeRemove hardening kept. New setCosmetics() feeds resolved css[]+procedural[] from selectorsForHostname.
- entrypoints/content.ts: parses settings.cosmeticFilters, resolves for location.hostname, seeds the hider, and re-resolves on settingsItem.watch.
- entrypoints/popup: Export (serialize current settings to JSON, copy to clipboard) and Import (validate + settingsItem.setValue) actions, plus a cosmetic-filters textarea.
- Tests: unit tests for procedural :has-text/:has/idempotency and lossless import/export round-trip; e2e test that a localhost-scoped :has-text rule hides a CSS-untargetable card, then export->clear->import keeps it hidden. vitest.config now uses WxtVitest() so storage-backed modules load under test.

Tests: npm run gate (green: format/lint/compile/46 unit tests/build) and npm run test:e2e (5 passed).
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 All quality gates green (npm run gate)
- [x] #2 Docs updated if behavior changed
<!-- DOD:END -->
