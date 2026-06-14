---
id: TASK-003
title: Phase 2 — Filter engine maturity
status: To Do
assignee: []
created_date: '2026-06-14 12:45'
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
- [ ] #1 A domain-scoped procedural rule hides an element plain CSS cannot, and survives import/export round-trip
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All quality gates green (npm run gate)
- [ ] #2 Docs updated if behavior changed
<!-- DOD:END -->
