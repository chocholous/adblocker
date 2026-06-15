# On-demand AI cleanup (Claude)

A user-triggered "Clean up this page" action that asks Claude to pick which
elements on the current page are clutter, previews hiding them, and lets the user
save the picks as permanent rules. It supports selectable model tiers, an
optional vision mode, and two authentication methods.

> **This is not a runtime path.** Cosmetic filtering at page load is pure selector
> matching (see [`architecture.md`](architecture.md)). The model is involved only
> when the user explicitly clicks the button — it _authors_ selectors, it does not
> run on every page. Per-page LLM detection is the wrong design (cost, latency,
> privacy); runtime detection stays pure selector matching.

## Flow

```
Popup: "Clean up this page (AI)"
  └─ runtime.sendMessage → background.ts   (sch:cleanupRequest { tabId })
        ├─ resolve credential for the chosen auth method (else clear error)
        ├─ tabs.sendMessage → content.ts   (sch:buildDigest)
        │     └─ buildPageDigest()         lib/digest.ts — compact structural digest
        ├─ [vision] chrome.tabs.captureVisibleTab  — screenshot of the visible tab
        └─ detectElementsToHide()          lib/anthropic.ts — Claude call (model tier)
        ◀─ rules: [{ selector, label, category }]   (allow-listed against the digest)
  ◀─ rules
  ├─ tabs.sendMessage → content.ts (sch:preview) — temporary <style>, nothing saved
  └─ render checklist → "Save selected" merges into settings.hideSelectors
                        "Clear" removes the preview
```

The privileged work — the screenshot capture and the Anthropic call — runs in the
**background service worker**, never in the page. The popup triggers the request
during the user's click so the `activeTab` gesture is available for
`chrome.tabs.captureVisibleTab` in vision mode.

## Authentication (two options, user's choice)

The popup's **Authentication** selector (`settings.aiAuthMethod`) picks one of:

- **API key (BYO)** — a personal Anthropic API key. Sent as the `x-api-key`
  header (SDK `apiKey` option). Stored in `apiKeyItem` (`local:anthropicApiKey`).
- **Claude subscription (OAuth token)** — a Claude subscription OAuth **access
  token** the user pastes in. Sent as `Authorization: Bearer <token>` (SDK
  `authToken` option, **no** `x-api-key`) together with the
  `anthropic-beta: oauth-2025-04-20` header the API requires for OAuth
  credentials. Stored in `oauthTokenItem` (`local:anthropicOauthToken`).

`lib/anthropic.ts` `buildClientOptions(authMethod, credential)` constructs the SDK
client options for the selected method and throws a clear error when the chosen
method has no credential. Both paths also send
`anthropic-dangerous-direct-browser-access: true` (we run in the extension's own
origin, not a page).

> **Acquiring an OAuth token** is currently a manual step (e.g. via
> `ant auth login` → `ant auth print-credentials --access-token`, or another
> Claude OAuth flow). The token is short-lived; paste a fresh one when it
> expires. A built-in token-acquisition flow is a possible follow-up.

## Model tiers

The **Model** dropdown (`settings.aiModel`) selects the Claude model used for the
call. `AI_MODEL_IDS` maps the tier to the concrete model ID:

| Tier (default `haiku`) | Model ID            |
| ---------------------- | ------------------- |
| Haiku                  | `claude-haiku-4-5`  |
| Sonnet                 | `claude-sonnet-4-6` |
| Opus                   | `claude-opus-4-8`   |

Haiku is the fastest/cheapest and the default; Sonnet and Opus trade cost for
capability on harder pages.

## Vision mode

When the **Vision mode** toggle (`settings.aiVision`) is on, the background
captures the visible tab with `chrome.tabs.captureVisibleTab` (JPEG, quality 70)
and sends the screenshot as a base64 **image content block** alongside the digest.
Each digest node carries its on-screen rectangle (`rect`) and the digest carries
the device pixel ratio (`dpr`), so the multimodal model can relate image regions
to candidate elements and flag first-party/native ads a text-only digest misses.

The model is asked to **mark which digest elements are ads** — the image only
_informs the choice_. Returned selectors are still **allow-listed against the
digest**, so the model can never invent a selector from the image. If the
screenshot can't be captured, the call **degrades to the text-only path** rather
than failing.

## What gets sent to the model

`buildPageDigest()` (`lib/digest.ts`) sends a **bounded structural digest**, never
the whole page:

- Up to ~120 visible "block" candidates, largest first.
- Per node: a locally-generated CSS selector, tag, id, up to 6 classes, `role`,
  `aria-label`, an **80-char** text snippet, and its on-screen rectangle.
- Page `hostname + pathname` (no query string), title, viewport, and `dpr`.
- In **vision mode only**: a JPEG screenshot of the current viewport.

Tiny, oversized (full-page wrapper), and invisible elements are dropped before
sending, which keeps the payload (and cost) small.

## Safety constraints

- **Selectors are allow-listed.** The model is told to copy selectors verbatim from
  the digest, and `detectElementsToHide()` discards any returned selector that
  wasn't in the digest — so the model can't inject an arbitrary selector. This
  holds for the vision path too: the image only informs the choice.
- **Structured output.** The response is constrained to a JSON schema
  (`{ rules: [{ selector, label, category }] }`).
- **Preview before persist.** Detected rules are applied as a temporary `<style>`;
  nothing is saved until the user clicks "Save selected".
- **Runtime stays pure selector matching.** The AI never runs at page load and
  never blocks requests.

## Privacy

- **Credentials are local-only.** Both the API key and the OAuth token live in
  `chrome.storage.local` (never `sync`), so secrets don't propagate across devices.
- **Screenshots go to the user's own Anthropic account.** In vision mode the
  screenshot of the current tab is sent only to Anthropic, authenticated with the
  user's own credential (their API key or their Claude subscription). It is not
  sent anywhere else and is not stored by the extension.
- **All AI calls run in the background SW**, so credentials are never exposed to
  web content.

## Known follow-ups

- The Anthropic SDK pulls Node-only credential code (`node:fs`/`node:path`) that
  Vite externalizes; we never hit those paths (credential is passed directly), but
  the background bundle is larger as a result. A raw `fetch` to `POST /v1/messages`
  would trim it if bundle size matters.
- No built-in OAuth token-acquisition flow yet — the user pastes a token obtained
  out of band, and refreshes it manually when it expires.
- No request cap / spend guard yet — add a simple rate limit before shipping.
- The digest's selector generator is heuristic; pair it with `@adguard/extended-css`
  if procedural selectors are needed for the saved rules.

```

```
