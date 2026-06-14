---
id: TASK-002.02
title: Validate hide/remove on real sites
status: Done
assignee:
  - '@claude'
created_date: '2026-06-14 12:46'
updated_date: '2026-06-14 15:10'
labels:
  - phase-1
dependencies: []
parent_task_id: TASK-002
ordinal: 2013
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Manually verify cosmetic hide + remove on 2-3 real sites (news/social/video).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Hide and remove both confirmed working on at least 3 real sites, with notes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Validated via Playwright loading the built extension into real Chromium (mirrors e2e harness). Selectors seeded into chrome.storage.sync (key 'settings') from the popup page, then target tab navigated fresh.

Wikipedia: hide .vector-header-container + #vector-page-tools-pinned-container (display:none, still in DOM); remove #vector-main-menu (detached). HN: hide .pagetop + td[bgcolor]; remove .yclinks. MDN: hide header; remove footer.

All 3: HIDE/REMOVE/content-intact/persistence (2nd path) PASS. Evidence screenshots before+after+persist captured. Note: sandbox TLS-intercept proxy required --ignore-certificate-errors (cert trust only; no DOM/behavior change).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Confirmed cosmetic hide + remove on 3 real sites (Wikipedia, Hacker News, MDN) with before/after/persistence screenshots. Hide => element kept in DOM but display:none; remove => element detached; page content intact; behavior holds across in-page navigation. Selectors applied via the popup's chrome.storage.sync item, same path users use.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 All quality gates green (npm run gate)
<!-- DOD:END -->
