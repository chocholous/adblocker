---
id: TASK-015
title: >-
  Validated ad-blocking at scale (60 ad-heavy hidden / 30 clean no
  false-positives)
status: To Do
assignee: []
created_date: '2026-06-14 16:09'
labels:
  - goal
  - engine
dependencies: []
ordinal: 7013
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Goal: plugin perfectly functional on >=60 ad-heavy pages (ads hidden) and >=30 ad-free pages (zero false-positives, no real content removed). Use real filter lists (EasyList, EasyPrivacy, uBlock, AdGuard, Fanboy) via a hybrid engine (@ghostery/adblocker core + our procedural/extended-css layer).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On the curated corpus, >=60 ad-heavy pages show ads substantially hidden AND >=30 ad-free pages show zero false-positives (no real content removed), measured by the validation harness with evidence
<!-- AC:END -->
