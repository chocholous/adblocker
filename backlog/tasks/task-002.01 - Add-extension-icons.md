---
id: TASK-002.01
title: Add extension icons
status: Done
assignee:
  - '@claude'
created_date: '2026-06-14 12:46'
updated_date: '2026-06-14 14:55'
labels:
  - phase-1
dependencies: []
parent_task_id: TASK-002
ordinal: 1013
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add public/icon/{16,32,48,128}.png so the manifest ships real icons.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Manifest references icons; they render in chrome://extensions and the toolbar
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added pure-Node PNG icon generator (scripts/gen-icons.mjs) and committed public/icon/{16,32,48,128}.png; verified the built manifest references all four icon sizes. Gate green.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 All quality gates green (npm run gate)
<!-- DOD:END -->
