---
id: TASK-015.01
title: 'Hybrid filter engine: @ghostery/adblocker + procedural layer'
status: Done
assignee:
  - '@claude'
created_date: '2026-06-14 16:09'
updated_date: '2026-06-14 17:29'
labels:
  - engine
dependencies: []
parent_task_id: TASK-015
ordinal: 8013
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the ~20 hand-picked selectors with a real engine: @ghostery/adblocker core loading EasyList/EasyPrivacy/uBlock/AdGuard (network via MV3 DNR + cosmetic), plus our :has-text/extended-css procedural layer for edge cases. Bundle lists for offline/deterministic build.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The built extension loads real filter lists and applies network + cosmetic filtering; per-hostname cosmetics work; existing settings/procedural rules still honored; gate + e2e green
<!-- AC:END -->
