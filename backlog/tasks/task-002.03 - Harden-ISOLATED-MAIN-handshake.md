---
id: TASK-002.03
title: Harden ISOLATED<->MAIN handshake
status: Done
assignee:
  - '@claude'
created_date: '2026-06-14 12:46'
updated_date: '2026-06-14 14:58'
labels:
  - phase-1
dependencies: []
parent_task_id: TASK-002
ordinal: 3013
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MAIN-world script requests config on init instead of only listening, so it can't miss the dispatch.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 MAIN world reliably receives spoof config regardless of script load order
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Harden the ISOLATED<->MAIN content-script handshake so the MAIN world reliably receives the spoof config regardless of script load order.

Problem: both content scripts run at document_start with no guaranteed order. Previously the MAIN-world scriptlet only *listened* for the 'sch:config' CustomEvent. If the ISOLATED world had already dispatched it, MAIN missed it permanently (a load-order race), leaving anti-adblock spoofing un-applied.

Fix (request/response handshake in new lib/bridge.ts):
- ISOLATED (serveSpoofConfig): eagerly pushes the config once AND listens for a new 'sch:request-config' event, re-dispatching the current config on each request. getConfig is a callback so live settings changes are reflected.
- MAIN (requestSpoofConfig): listens for config AND fires a request on init, so an already-initialized ISOLATED world responds.
- Both orderings covered: ISOLATED-first (request/response) and MAIN-first (eager push reaches the live listener).
- Idempotent: receiving config any number of times safely re-applies the latest value; malformed payloads are ignored.
- MAIN scriptlet stays defensive (bridge wiring wrapped in try/catch; no chrome.* use).

Tests:
- tests/bridge.test.ts (vitest, happy-dom): 6 cases covering both load orderings, latest-config-on-re-request, idempotency, malformed-payload rejection, and listener disposal. Each test uses a fresh EventTarget for hermetic isolation.
- e2e/extension.spec.ts: new Playwright test asserts window.adsbygoogle.loaded === true in page context, proving the MAIN world received the config via the handshake.

Validation: npm run gate green (format, lint, compile, 14 unit tests, build); npm run test:e2e green (2/2).
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 All quality gates green (npm run gate)
<!-- DOD:END -->
