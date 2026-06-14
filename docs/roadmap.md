# Development roadmap

The full lifecycle for the Stealth Content Hider extension, from the current
scaffold through store release and ongoing maintenance. Each phase lists its
**goal**, **key tasks**, and an **exit criterion** (the check that says the phase
is done). Phases are roughly sequential, but the testing/CI and security tracks
run continuously from Phase 2 onward.

## Principles

- **Cosmetic-first, network-second.** Hiding happens in content scripts; network
  blocking (`declarativeNetRequest`) is reserved for trackers/telemetry.
- **Least privilege.** Every permission must be justified in the store listing.
  Drop anything unused.
- **No data exfiltration.** The extension never phones home. This is a feature
  and a review-survival requirement.
- **Deterministic builds.** `package-lock.json` is committed; CI builds from it.

## Branching & versioning

- `main` — always releasable. Protected; merges via PR + green CI.
- `claude/adoring-fermat-t9jplc` — current working branch for the scaffold.
- Feature work on `feat/<short-name>`; fixes on `fix/<short-name>`.
- **SemVer** on the extension version (`wxt.config.ts` → `manifest.version`):
  patch = fixes, minor = features, major = breaking settings/permission changes.
- Tag releases `vX.Y.Z`; keep `CHANGELOG.md` (Keep a Changelog format).
- Optional beta channel: a separate unlisted store item built from `feat/*`.

---

## Phase 0 — Foundations ✅ (done)

**Goal:** a project that installs, type-checks, and builds.

- WXT + TypeScript MV3 scaffold, two-layer content scripts, popup, DNR ruleset.
- `npm install`, `wxt prepare`, `tsc --noEmit`, `wxt build` all green.

**Exit:** `npm run build` produces a loadable `.output/chrome-mv3/`. ✅

## Phase 1 — MVP core loop

**Goal:** a user can hide real elements on real pages and it persists.

- Validate the hide/remove pipeline against live sites (news, social, video).
- Harden the ISOLATED↔MAIN `CustomEvent` bridge for ordering (MAIN may load
  before ISOLATED dispatches): have MAIN request config on init, ISOLATED replies.
- Per-frame correctness: confirm `all_frames` behavior and `about:blank` iframes.
- Add basic icons (`public/icon/{16,32,48,128}.png`).

**Exit:** install unpacked, add a selector in the popup, reload a page → element
is hidden and stays hidden across navigations and browser restart.

## Phase 2 — Filter engine maturity

**Goal:** expressive, per-site filtering instead of one global selector list.

- **Per-domain rules**: scope selectors to hostnames (`example.com##.ad`).
- **Filter syntax**: adopt a uBlock-style subset (`##` hide, `#@#` unhide,
  `#?#` procedural). Write a small parser in `lib/filters/`.
- **Procedural cosmetics**: `:has()`, `:matches-css()`, `:contains()` fallbacks
  evaluated in JS where native CSS can't express them.
- **Allowlist / disable-per-site** toggle.
- **Import/export** filter lists (text + JSON); optional remote list fetch with
  manual update (no auto-tracking).

**Exit:** a domain-scoped procedural rule hides an element that a plain CSS
selector cannot, and survives import/export round-trip.

## Phase 3 — Element picker

**Goal:** point-and-click rule creation (the feature users actually want).

- Overlay UI injected into the page (closed Shadow DOM so the page can't touch it).
- Hover highlight → click selects → generate a robust selector (id/class/nth).
- Preview hide, then "Create rule" writes to settings.
- Keyboard escape / undo.

**Exit:** user picks an element with no CSS knowledge and it's permanently hidden.

## Phase 4 — Anti-detection layer

**Goal:** sites that detect blockers can't tell content is hidden.

- Scriptlet library in the MAIN world: bait-element spoofing, `window.*` getters
  (`adsbygoogle`, `googletag`), `fetch`/`XHR` shims returning benign responses.
- Config-driven: each scriptlet toggleable from settings via the bridge.
- Test against known anti-adblock walls; document the counter for each.

**Exit:** a chosen anti-adblock test page does not trigger its block-wall while
the target elements remain hidden.

## Phase 5 — Network layer

**Goal:** cancel trackers/telemetry without breaking pages.

- Dynamic DNR rules via `updateDynamicRules()` for user-added blocks.
- Static rulesets organized by category; respect the ~30k static-rule cap.
- Session rules for tab-scoped temporary blocks.
- Surface blocked-count in the popup.

**Exit:** a user-added network rule blocks a request (visible in DevTools) and
can be toggled off live.

## Phase 6 — UX & settings polish

**Goal:** a coherent, accessible product surface.

- Full **options page** (`entrypoints/options/`) for list management; popup stays
  quick-actions only.
- Settings **schema versioning + migrations** (`storage.defineItem({ version })`
  with `migrations`), quota handling, sync-vs-local choice.
- i18n (`_locales/`), dark mode, empty/error states, ARIA.

**Exit:** upgrading from an older settings schema migrates cleanly with no data
loss; UI passes a basic a11y pass.

## Phase 7 — Testing

**Goal:** changes are safe to ship without manual re-checking everything.

- **Unit** (Vitest): filter parser, selector generation, `lib/hider.ts` logic,
  settings migrations. Use `@webext-core/fake-browser` for storage/`browser`.
- **Integration**: content-script behavior against jsdom/happy-dom fixtures.
- **E2E** (Playwright, `launchPersistentContext` with the built extension):
  load a fixture page, assert elements hidden, popup flows, picker.
- **Manual matrix**: Chrome, Edge, Firefox; document_start timing; SPA sites.

**Exit:** `npm test` runs unit+integration green; one Playwright E2E loads the
extension and asserts a hide works.

## Phase 8 — Tooling, CI & quality gates

**Goal:** every push is linted, typed, tested, and built automatically.

- Add ESLint (`@typescript-eslint`) + Prettier; `npm run lint`, `npm run format`.
- GitHub Actions: matrix job → install, `lint`, `compile`, `test`, `build`,
  upload `.output` + `.zip` artifacts. Cache npm.
- Pre-commit hook (lint-staged) optional.
- Dependabot/renovate for dependency PRs.

**Exit:** a PR shows green checks for lint + typecheck + test + build, with the
built zip attached as an artifact.

## Phase 9 — Performance & robustness

**Goal:** fast and stable on heavy pages and large filter lists.

- Throttle/batch `MutationObserver` work; disconnect when idle.
- Benchmark large selector lists; precompile selector lists once.
- Memory checks on long-lived SPA tabs; avoid leaks in the picker overlay.
- Graceful behavior under strict CSP and in cross-origin frames.

**Exit:** on a chosen heavy page, observer CPU stays negligible and there's no
measurable memory growth over 10 minutes of scrolling.

## Phase 10 — Security & privacy review

**Goal:** survive store review and deserve user trust.

- Permission audit: remove anything unused; write per-permission justifications.
- Confirm zero outbound network from the extension itself; no remote code.
- Supply-chain: `npm audit`, pin/lock deps, review transitive additions.
- Shadow-DOM isolation for injected UI; no page-detectable runtime `<link>`.
- Draft a **privacy policy** (required by stores).

**Exit:** `npm audit` clean of high/critical, permissions list minimal and
justified, privacy policy written.

## Phase 11 — Release & store submission

**Goal:** published, installable builds on the target stores.

- Store assets: icons, screenshots, promo tiles, listing copy, category.
- Build per target: `wxt zip` (Chrome/Edge) and `wxt zip -b firefox` (AMO).
- Submit:
  - **Chrome Web Store** — Developer Dashboard; justify `host_permissions`,
    `declarativeNetRequest`, `scripting`.
  - **Edge Add-ons** — Partner Center (Chromium zip).
  - **Firefox AMO** — `web-ext`/AMO; note MV2/MV3 differences.
- Automate uploads later (`wxt submit` / `chrome-webstore-upload`) once stable.
- Tag `vX.Y.Z`, update `CHANGELOG.md`, attach zips to a GitHub Release.

**Exit:** the extension is live (or in review) on at least the Chrome Web Store
with a tagged, changelog'd release.

## Phase 12 — Maintenance loop

**Goal:** stay working as sites and browser policies change.

- Triage user-reported broken sites; add/adjust filters or scriptlets.
- Watch Chrome MV3 / DNR policy changes and AMO review feedback.
- Periodic dependency updates via CI PRs; re-run full test suite.
- Cut patch releases for site-breakage fixes; minor for features.

**Exit (ongoing):** a recurring cadence (e.g. monthly) of dependency updates and
filter fixes, each shipped through the CI + release pipeline above.

---

## Key engineering decisions

- **Reuse, don't rebuild.** The procedural engine (Phase 2) and scriptlets
  (Phase 4) are maintained libraries: `@ghostery/adblocker` (filter-list engine +
  cosmetic filtering), `@adguard/extended-css` (`:has`/`:contains`/`:matches-css`),
  and `@adguard/scriptlets` (anti-adblock). Curated rules come from filter-list
  registries (EasyList, AdGuard, uBlock; directory at filterlists.com). Integrate
  these rather than hand-writing the engine.
- **AI cleanup authors, it does not detect at runtime.** The on-demand "Clean up
  this page" button uses Claude Haiku to author selectors from a compact page
  digest; runtime detection stays pure selector matching (cost/latency/privacy).
  See [`ai-detector.md`](ai-detector.md).

## Tooling to add along the way

| When     | Add                                                         | Purpose                       |
| -------- | ----------------------------------------------------------- | ----------------------------- |
| Phase 7  | `vitest`, `@webext-core/fake-browser`, `happy-dom`          | Unit/integration tests        |
| Phase 7  | `@playwright/test`                                          | E2E with the extension loaded |
| Phase 8  | `eslint`, `@typescript-eslint/*`, `prettier`, `lint-staged` | Lint/format gates             |
| Phase 8  | GitHub Actions workflow                                     | CI                            |
| Phase 11 | `web-ext` (Firefox), `chrome-webstore-upload-cli`           | Store packaging/upload        |

## CI pipeline (target shape)

```
push / PR
  └─ setup node 22 + cache npm
     └─ npm ci
        ├─ npm run lint        (Phase 8)
        ├─ npm run compile     (tsc --noEmit)        ← available now
        ├─ npm test            (Phase 7)
        ├─ npm run build       (wxt build)           ← available now
        └─ upload artifacts: .output/, *.zip
release tag vX.Y.Z
  └─ build + zip (chrome, firefox) → attach to GitHub Release → (optional) submit
```

## Execution

Work is tracked task-by-task on the Backlog.md board (`backlog/`, snapshot in
[`../backlog/Board.md`](../backlog/Board.md)). Each task's Definition of Done is
the green quality gates (see [`gates.md`](gates.md)).
