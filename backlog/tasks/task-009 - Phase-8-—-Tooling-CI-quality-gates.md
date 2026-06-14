---
id: TASK-009
title: 'Phase 8 — Tooling, CI & quality gates'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-06-14 12:45'
updated_date: '2026-06-14 14:22'
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. ci.yml: po buildu přidat krok 'wxt zip' (Chrome/Edge, bez Firefoxu) a upload .output/*.zip jako artefakt
2. Přidat .github/dependabot.yml: npm + github-actions, weekly
3. Ověřit lokálně: npm run gate + npm run zip (zip se vytvoří v .output/)
4. Commit + push + draft PR; po zelené CI ověřit AC #1 (zip artefakt v běhu) a mergnout
<!-- SECTION:PLAN:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All quality gates green (npm run gate)
- [ ] #2 Docs updated if behavior changed
<!-- DOD:END -->
