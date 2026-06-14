---
id: TASK-009
title: 'Phase 8 — Tooling, CI & quality gates'
status: In Progress
assignee: []
created_date: '2026-06-14 12:45'
labels:
  - phase-8
  - ci
dependencies:
  - TASK-001
ordinal: 8
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ESLint+Prettier, CI, pre-commit hook shipped. Remaining: zip artifact, dependabot.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A PR shows green lint+typecheck+test+build, with the built zip attached as an artifact
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All quality gates green (npm run gate)
- [ ] #2 Docs updated if behavior changed
<!-- DOD:END -->
