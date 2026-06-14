---
id: TASK-003.01
title: Default ad filter set
status: To Do
assignee: []
created_date: '2026-06-14 15:40'
labels:
  - phase-2
dependencies: []
parent_task_id: TASK-003
ordinal: 4013
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ship curated generic ad/consent/newsletter hide selectors in DEFAULT_SETTINGS, validated against real ad-heavy sites (from the vision study), avoiding broad false-positive selectors.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 DEFAULT_SETTINGS.hideSelectors includes vetted generic selectors (GPT/doubleclick/taboola/outbrain ad slots, OneTrust consent, newsletter) and an e2e fixture proves they hide ads without removing real content
<!-- AC:END -->
