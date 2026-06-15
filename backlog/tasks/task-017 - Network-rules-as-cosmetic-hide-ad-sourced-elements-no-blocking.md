---
id: TASK-017
title: 'Network-rules-as-cosmetic (hide ad-sourced elements, no blocking)'
status: Done
assignee:
  - '@claude'
created_date: '2026-06-15 08:59'
updated_date: '2026-06-15 10:01'
labels:
  - engine
dependencies: []
ordinal: 11013
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Use the engine's network filters to hide elements whose resources load from ad/tracker domains — never block requests (stealth). Zero false-positives.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Elements sourced from ad/tracker domains are hidden after load (no request blocking); first-party content untouched; gate+e2e green; 0 clean-corpus false-positives
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add network matcher to lib/engine.ts: matchResources(engine, items[]) -> matched ids, respecting exceptions.
2. Add sch:matchResources message type in lib/detect.ts + background handler (gated on settings.enabled).
3. Content script: collect resource elements, map to request types, batch-query background, hide matched via hardened display:none. Conservative container collapse only for zero-area/sole-child wrappers. Debounced ~400ms re-runs in bounded window, per-URL verdict cache, idempotent, fully try/caught.
4. build-filters.mjs: add uBO unbreak/quick-fixes/annoyances-others, AdGuard URL Tracking, Peter Lowe adservers. Regenerate bin; check <15MB.
5. Unit tests + e2e fixture (ad iframe + benign first-party iframe).
6. gate + e2e green; validation clean 0 FP.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented:
- lib/engine.ts: matchResources(engine, items, sourceUrl) + matchResourcesForFrame async wrapper; respects exceptions via engine.match.
- lib/detect.ts: MatchResourcesMessage/Response types + RuntimeMessage union.
- entrypoints/background.ts: sch:matchResources handler, gated on settings.enabled.
- lib/net-hide.ts: collectResources (iframe/img/video/source/embed/object -> sub_frame/image/media/other), runHidePass with per-URL verdict cache, idempotent HIDDEN_ATTR marker, conservative sole-child wrapper collapse (never landmarks), fully try/caught.
- entrypoints/content.ts: debounced (~400ms) hide pass in 15s bounded window, gated on settings.enabled.
- scripts/build-filters.mjs: added uBO unbreak/quick-fixes/annoyances-others, AdGuard URL Tracking (17), Peter Lowe adservers. Regenerated bin ~9.98MB (<15MB).
- tests/net-hide.test.ts: 11 tests (matcher, collect, hide, idempotency, cache, wrapper collapse).
- e2e: route-based fixture server + ad-iframe vs first-party test.
Gate green (81 unit tests); e2e green (8 tests).
<!-- SECTION:NOTES:END -->
