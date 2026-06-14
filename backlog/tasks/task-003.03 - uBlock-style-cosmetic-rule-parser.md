---
id: TASK-003.03
title: uBlock-style cosmetic rule parser
status: To Do
assignee: []
created_date: '2026-06-14 15:40'
labels:
  - phase-2
dependencies: []
parent_task_id: TASK-003
ordinal: 6013
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Foundation for uBlock/EasyList cosmetic syntax. Parse generic and domain-scoped cosmetic rules (##selector, domain##selector, exceptions #@#) into per-hostname selectors, including at least one procedural selector plain CSS cannot express. Self-contained module + tests; engine integration is a follow-up.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A parser turns uBO/EasyList cosmetic syntax (incl. domain scoping + a procedural selector beyond plain CSS) into the correct per-hostname selector set, unit-tested
<!-- AC:END -->
