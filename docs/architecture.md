# Architecture

The core idea — hide content visually while the server still registers a full
page load — is exactly what modern ad blockers do with **cosmetic filtering**.

## Two complementary layers

| Layer              | API                      | What it does                                            | Stealthy?                                       |
| ------------------ | ------------------------ | ------------------------------------------------------- | ----------------------------------------------- |
| Network blocking   | `declarativeNetRequest`  | Cancels requests before they reach the server           | No — server sees the resource was never fetched |
| Cosmetic filtering | content scripts + CSS/JS | Lets the request complete, then hides the resulting DOM | Yes — server sees a normal load                 |

For the goal _"the web thinks you see it, but you don't"_, **cosmetic filtering is
the primary mechanism**. Requests are allowed through; the resulting elements are
hidden from view. Network blocking (`public/rules.json`) is reserved for trackers
and telemetry you genuinely want to cancel.

## Execution worlds

`chrome.scripting` injects into one of two JS worlds:

| World                | Page JS access        | `chrome.*` access | Detectable by page |
| -------------------- | --------------------- | ----------------- | ------------------ |
| `ISOLATED` (default) | No                    | Yes               | Harder             |
| `MAIN`               | Yes (shares `window`) | No                | Easier             |

This project uses **ISOLATED** (`entrypoints/content.ts`) for all cosmetic work,
and **MAIN** (`entrypoints/main-world.content.ts`) only to patch page-level globals that
power anti-adblock detection. The two are bridged with a `CustomEvent`
(`sch:config`) because MAIN-world code cannot read extension storage.

## Hiding techniques (simple → advanced)

1. **Static CSS at `document_start`** — `assets/hider.css`, injected via
   `cssInjectionMode: 'manifest'`. Applied before paint, so no
   flash-of-unhidden-content (FOUC).
2. **Dynamic stylesheet** — `lib/hider.ts` builds a `display: none` rule from the
   user's `hideSelectors` and updates it live when settings change.
3. **`MutationObserver`** — catches dynamically inserted nodes (SPAs, infinite
   scroll) and can fully `remove()` matches in `removeSelectors`.
4. **MAIN-world scriptlets** — override page globals (e.g. present a benign
   `window.adsbygoogle`) so bait checks pass while real elements stay hidden.

## Anti-detection strategy

| Detection the site uses                                   | Counter-strategy here                                                      |
| --------------------------------------------------------- | -------------------------------------------------------------------------- |
| Bait element check (fake ad div, is it hidden?)           | Hide selectively; don't blanket-hide bait                                  |
| `window` property sniffing (`adsbygoogle`, `googletag`)   | Spoof via MAIN-world scriptlet                                             |
| Network request check (does an ad domain load?)           | Don't block at network level; hide cosmetically                            |
| DOM mutation watching for `display:none` on its own nodes | Use `remove()` instead of hiding                                           |
| Extension-origin `<link>` tag detection                   | Use manifest CSS injection / a `<style>` element, never a runtime `<link>` |

## Request lifecycle

```
manifest.json (MV3, WXT-generated)
│
├── service worker (background.ts) ......... seeds default settings
│
├── content.ts  [document_start, ISOLATED]
│     ├── inject assets/hider.css (no FOUC)
│     ├── build dynamic display:none stylesheet from settings
│     ├── MutationObserver → remove() dynamic matches
│     └── dispatch CustomEvent('sch:config') → MAIN world
│
├── main-world.content.ts  [document_start, MAIN]
│     └── patch window.* to neutralize bait/anti-adblock checks
│
└── declarativeNetRequest (public/rules.json)
      └── block trackers / telemetry — NOT page content
```
