---
id: TASK-018
title: 'AI deep-clean: model tiers (Haiku/Sonnet/Opus) + vision + dual auth'
status: To Do
assignee: []
created_date: '2026-06-15 10:16'
labels:
  - feature
  - ai
dependencies: []
ordinal: 12013
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend on-demand AI cleanup (TASK-014, Haiku-only, text digest) with: selectable model tiers (Haiku default -> Sonnet -> Opus) and optional auto-escalation when a weak result still leaves visible ads; an optional VISION mode (page screenshot -> multimodal model identifies ad regions -> mapped to verified selectors), useful for first-party/native ads that lists miss; and TWO authentication options the user can choose between. Keep runtime pure selector matching; selectors stay allow-listed/verified against the DOM; credentials stored locally only; calls from the background SW.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 User can authenticate EITHER with a BYO Anthropic API key OR a Claude subscription OAuth token, and either drives the AI cleanup
- [ ] #2 User can pick the model tier (Haiku/Sonnet/Opus); a vision mode sends a page screenshot and returns allow-listed, DOM-verified selectors that hide ads a text-only digest misses
- [ ] #3 Credentials are stored locally only; no selector outside the page/allow-list is ever applied; gate + e2e green
<!-- AC:END -->
