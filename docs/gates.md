# Quality gates

Gate checks are the spine of the workflow: no change reaches `main` without
passing every gate, the same way tests and user testing are non-negotiable. This
document defines the gates, when each runs, and how the test layers and user
testing fit around them.

## The one rule

**Nothing merges red.** Every push and pull request runs the full automated gate
in CI ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)); a release
additionally requires the manual gates below. If a gate is flaky or wrong, fix the
gate — don't bypass it.

## Automated gates (every push / PR)

Run all of them locally in one shot with **`npm run gate`**. CI runs the identical
sequence.

| #   | Gate                       | Command                | Blocks on                                                |
| --- | -------------------------- | ---------------------- | -------------------------------------------------------- |
| 1   | **Format**                 | `npm run format:check` | Any file not Prettier-formatted (`npm run format` fixes) |
| 2   | **Lint**                   | `npm run lint`         | ESLint error (`npm run lint:fix` autofixes most)         |
| 3   | **Type-check**             | `npm run compile`      | Any `tsc --noEmit` error                                 |
| 4   | **Unit/integration tests** | `npm test`             | A failing or absent-but-expected test                    |
| 5   | **Build**                  | `npm run build`        | A broken production build (`wxt build`)                  |

Ordering is intentional — cheapest, most-localized failures first (format, lint),
then types, then behavior (tests), then the full build. A failure stops the chain.

### E2E gate (separate)

`npm run test:e2e` builds the extension and runs Playwright, which loads the
built `.output/chrome-mv3/` into real Chromium (new headless, so no display
server needed) and asserts a default selector actually hides an element. It is a
**separate CI job** and is intentionally **not** part of `npm run gate` — it
downloads a browser and is slower than the unit gates.

### Planned additions (roadmap)

| Gate                             | When it lands | Notes                                                           |
| -------------------------------- | ------------- | --------------------------------------------------------------- |
| **Bundle-size check**            | Phase 9       | Fail if `background.js` / content scripts exceed a budget       |
| **Security & permission review** | Phase 10–11   | `npm audit` clean + permission justification (pre-release gate) |

## Test layers

The automated test gate (#4) is a pyramid, widest at the bottom:

| Layer           | Tool               | Scope                                                                                        | Status |
| --------------- | ------------------ | -------------------------------------------------------------------------------------------- | ------ |
| **Unit**        | Vitest             | Pure logic — `filterToAllowedSelectors`, selector generation                                 | ✅ now |
| **Integration** | Vitest + happy-dom | DOM behavior — `createHider` hide/remove, `cssPath`, `buildPageDigest`                       | ✅ now |
| **E2E**         | Playwright         | Built extension in real Chromium — hide-on-load verified; popup flows + AI cleanup to expand | ✅ now |

Tests live in `tests/` and run against modules that avoid WXT runtime imports, so
the suite needs no browser-extension harness. DOM tests use `happy-dom`
(`vitest.config.ts`); a small `tests/setup.ts` polyfills `CSS.escape`.

**Coverage expectations:** every bug fix lands with a regression test; every new
pure function in `lib/` ships with unit tests. Security-relevant logic (e.g. the
selector allow-list that stops the AI model injecting arbitrary CSS) must stay
tested.

## Manual gates (pre-release)

Automated gates prove the code is internally correct; these prove it works for a
person. Required before tagging a release:

- **Code review.** At least one reviewer on every PR. The `/code-review` and
  `/security-review` skills assist but don't replace a human.
- **User testing (dogfooding + matrix).** Load the unpacked build and walk the
  matrix:
  - Cosmetic hiding on a few real sites (news, social, video).
  - Dynamically-added content (SPA / infinite scroll) gets caught.
  - Anti-adblock: a known block-wall doesn't trigger while targets stay hidden.
  - The AI cleanup flow end-to-end: button → preview → save → persists on reload.
  - Cross-browser: Chrome, Edge, Firefox.
- **Security & privacy review.** `npm audit` clean of high/critical; permissions
  minimal and justified; confirm the extension makes no network calls except the
  user-initiated Anthropic request.

A beta/unlisted store channel is the recommended place to run user testing at
scale before a public release.

## When each gate runs

| Stage                              | Gates                                                              |
| ---------------------------------- | ------------------------------------------------------------------ |
| Local, while coding                | `npm run test:watch`; `npm run lint` / `npm run compile` as needed |
| **Pre-commit (lint-staged hook)**  | Auto-fix lint + format on staged files                             |
| **Every push / PR (CI, enforced)** | The full `npm run gate` chain                                      |
| **Pre-release**                    | All of CI **plus** the manual gates above                          |

## Pre-commit hook

A git hook runs the fast subset (ESLint `--fix` + Prettier) on **staged files
only** before each commit, via `lint-staged`:

- The hook lives in `.githooks/pre-commit` (tracked in the repo, not generated).
- It is activated automatically: `npm install` runs the `prepare` script, which
  sets `git config core.hooksPath .githooks`.
- Config is the `lint-staged` block in `package.json`.

The hook is a convenience that catches the cheap mistakes early; it is **not** the
enforced boundary. CI re-runs the full gate on every push, so a bypassed or
missing hook (`git commit --no-verify`, a fresh clone before `npm install`) can
never let a regression reach `main`.
