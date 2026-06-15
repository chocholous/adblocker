---
id: TASK-018
title: 'AI deep-clean: model tiers (Haiku/Sonnet/Opus) + vision + dual auth'
status: Done
assignee:
  - '@claude'
created_date: '2026-06-15 10:16'
updated_date: '2026-06-15 10:45'
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
- [x] #1 User can authenticate EITHER with a BYO Anthropic API key OR a Claude subscription OAuth token, and either drives the AI cleanup
- [x] #2 User can pick the model tier (Haiku/Sonnet/Opus); a vision mode sends a page screenshot and returns allow-listed, DOM-verified selectors that hide ads a text-only digest misses
- [x] #3 Credentials are stored locally only; no selector outside the page/allow-list is ever applied; gate + e2e green
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented dual auth (apiKey via x-api-key; oauth via Authorization: Bearer + anthropic-beta: oauth-2025-04-20), model tiers (haiku/sonnet/opus -> claude-haiku-4-5/claude-sonnet-4-6/claude-opus-4-8), and vision mode (chrome.tabs.captureVisibleTab screenshot + digest, allow-listed). New local-only oauthTokenItem. Routed cleanup through background SW (sch:cleanupRequest -> sch:buildDigest -> capture -> Anthropic -> sch:preview). Added tests/anthropic.test.ts (mocked SDK) and e2e/popup-ai.spec.ts. gate + e2e green; clean validation 0 false-positives.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Extended the on-demand AI cleanup (TASK-014) with model tiers, vision, and dual auth, keeping runtime as pure selector matching and all selectors allow-listed/DOM-verified.

Auth (user picks one, credentials stored in chrome.storage.local only):
- API key -> x-api-key (SDK apiKey).
- Claude subscription OAuth token -> Authorization: Bearer + anthropic-beta: oauth-2025-04-20, no x-api-key (SDK authToken). New oauthTokenItem + aiAuthMethod setting; clear error if the selected method has no credential.

Model tiers: aiModel haiku|sonnet|opus -> claude-haiku-4-5 / claude-sonnet-4-6 / claude-opus-4-8 (default haiku).

Vision: aiVision toggle -> background captures the visible tab via chrome.tabs.captureVisibleTab (activeTab gesture from the popup; no new host perms) and sends the screenshot as an image block plus the bounding-box digest; returned selectors remain allow-listed; degrades to text path if capture fails.

Architecture: cleanup orchestrated in the background SW (sch:cleanupRequest -> sch:buildDigest in content -> optional capture -> Anthropic call -> sch:preview back to content). Popup gained the auth selector + matching input, a model dropdown, and a vision toggle.

Tests/gates: tests/anthropic.test.ts (mocked SDK: both auth header shapes, model mapping, allow-list rejects non-digest selectors, missing-credential errors) and e2e/popup-ai.spec.ts (popup wiring + no-credential error path). npm run gate green (104 unit tests); e2e green (11); clean validation 0 false-positives (29/30 reachable). No protected files modified.

Follow-up: no built-in OAuth token-acquisition UX (user pastes a token obtained out of band); no spend guard yet.
<!-- SECTION:FINAL_SUMMARY:END -->
