---
id: TASK-015.02
title: Large-scale validation harness + 60/30 corpus
status: To Do
assignee: []
created_date: '2026-06-14 16:09'
labels:
  - testing
dependencies: []
parent_task_id: TASK-015
ordinal: 9013
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Engine-agnostic Playwright harness over a curated corpus (~60 ad-heavy + ~30 ad-free URLs). For ad-heavy: measure visible ad real-estate reduction (enabled vs disabled). For clean: false-positives (real content/landmarks/innerText must not drop). Report per-site pass/fail + aggregate + unreachable.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Harness runs the built extension across the corpus and outputs a per-site + aggregate report of ad-hide success and clean-site false-positives; reachable-site counts recorded
<!-- AC:END -->
