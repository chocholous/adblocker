# On-demand AI cleanup (Claude Haiku)

A user-triggered "Clean up this page" action that asks Claude Haiku to pick which
elements on the current page are clutter, previews hiding them, and lets the user
save the picks as permanent rules.

> **This is not a runtime path.** Cosmetic filtering at page load is pure selector
> matching (see [`architecture.md`](architecture.md)). The model is involved only
> when the user explicitly clicks the button — it _authors_ selectors, it does not
> run on every page. Per-page LLM detection is the wrong design (cost, latency,
> privacy); runtime detection stays pure selector matching.

## Flow

```
Popup: "Clean up this page (AI)"
  └─ tabs.sendMessage → content.ts
        ├─ buildPageDigest()           lib/digest.ts — compact structural digest
        └─ runtime.sendMessage → background.ts
              └─ detectElementsToHide() lib/anthropic.ts — Claude Haiku call
        ◀─ rules: [{ selector, label, category }]
        └─ applyPreview()              temporary <style>, nothing saved yet
  ◀─ rules
  └─ render checklist → "Save selected" merges into settings.hideSelectors
                        "Clear" removes the preview
```

## What gets sent to the model

`buildPageDigest()` (`lib/digest.ts`) sends a **bounded structural digest**, never
the whole page:

- Up to ~120 visible "block" candidates, largest first.
- Per node: a locally-generated CSS selector, tag, id, up to 6 classes, `role`,
  `aria-label`, an **80-char** text snippet, and its on-screen rectangle.
- Page `hostname + pathname` (no query string) and title.

This keeps token cost low (Haiku is `claude-haiku-4-5`, ~$1/$5 per Mtok) and limits
what leaves the browser. Tiny, oversized (full-page wrapper), and invisible
elements are dropped before sending.

## Safety constraints

- **Selectors are allow-listed.** The model is told to copy selectors verbatim from
  the digest, and `detectElementsToHide()` discards any returned selector that
  wasn't in the digest — so the model can't inject an arbitrary selector.
- **Structured output.** The response is constrained to a JSON schema
  (`{ rules: [{ selector, label, category }] }`).
- **Preview before persist.** Detected rules are applied as a temporary `<style>`;
  nothing is saved until the user clicks "Save selected".

## API key

The feature is **bring-your-own-key**. The key is entered in the popup and stored
in `chrome.storage.local` (`apiKeyItem`, key `local:anthropicApiKey`) — **local,
never synced**, so the secret doesn't propagate across devices.

The Anthropic call runs in the **background service worker**, not in the page, so
the key is never exposed to web content. The SDK is initialized with
`dangerouslyAllowBrowser: true` (we are in the extension's own origin, not a site)
and the `anthropic-dangerous-direct-browser-access` header.

## Known follow-ups

- The Anthropic SDK pulls Node-only credential code (`node:fs`/`node:path`) that
  Vite externalizes; we never hit those paths (key is passed directly), but the
  background bundle is larger as a result. A raw `fetch` to `POST /v1/messages`
  would trim it if bundle size matters.
- No request cap / spend guard yet — add a simple rate limit before shipping.
- The digest's selector generator is heuristic; pair it with `@adguard/extended-css`
  if procedural selectors are needed for the saved rules.
