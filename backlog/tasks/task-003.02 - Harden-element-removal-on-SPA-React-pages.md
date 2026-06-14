---
id: TASK-003.02
title: Harden element removal on SPA/React pages
status: To Do
assignee: []
created_date: '2026-06-14 15:40'
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
- [ ] #1 Removing elements never throws/crashes on React-style pages; the hider degrades to display:none when a safe detach is not possible; covered by unit tests
<!-- AC:END -->
