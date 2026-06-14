---
id: TASK-002.03
title: Harden ISOLATED<->MAIN handshake
status: To Do
assignee: []
created_date: '2026-06-14 12:46'
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
- [ ] #1 MAIN world reliably receives spoof config regardless of script load order
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All quality gates green (npm run gate)
<!-- DOD:END -->
