---
id: TASK-003.01
title: Default ad filter set
status: Done
assignee:
  - '@claude'
created_date: '2026-06-14 15:40'
updated_date: '2026-06-14 15:45'
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
- [x] #1 DEFAULT_SETTINGS.hideSelectors includes vetted generic selectors (GPT/doubleclick/taboola/outbrain ad slots, OneTrust consent, newsletter) and an e2e fixture proves they hide ads without removing real content
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Expanded DEFAULT_SETTINGS.hideSelectors in lib/settings.ts with curated generic ad/consent/newsletter selectors from the real-site vision study (CNN, Healthline, TechRadar, Tom's Hardware, BoredPanda, FoodNetwork).

Changes:
- Added vetted selectors: GPT/AdSense/DoubleClick ad markers (ins.adsbygoogle, iframe[id^=google_ads_iframe], [id^=div-gpt-ad], [data-google-query-id], doubleclick/googlesyndication iframes, [aria-label=advertisement i]); native-ad networks (taboola/outbrain id+class); precise ad-slot tokens ([class~=ads], ad-slot/ad-unit/ad-container); OneTrust consent (#onetrust-banner-sdk, #onetrust-consent-sdk, .onetrust-pc-dark-filter); newsletter prompts.
- Deduped against existing defaults; kept them.
- Deliberately excluded broad [class*=ad i]/[id*=ad i] (study showed they destroy real content like CNN header__* and FoodNetwork hero).
- removeSelectors kept empty (remove() crashes React SPAs; display:none hiding is the safe default).

Tests: new e2e/default-filters.spec.ts builds a synthetic ad-heavy fixture (adsbygoogle ins, google_ads_iframe, ad-slot, taboola widget, #onetrust-banner-sdk, newsletter box + real article with ad-substring classes). Asserts each ad/consent/newsletter node is present but display:none, real content (#article, .header__nav) stays visible, and no node is removed from the DOM. npm run gate and npm run test:e2e both green (4/4 e2e).
<!-- SECTION:FINAL_SUMMARY:END -->
