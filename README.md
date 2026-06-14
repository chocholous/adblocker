# Stealth Content Hider

A Manifest V3 browser extension for **cosmetic content filtering**: pages load
normally (the server sees a full page view), but unwanted elements are suppressed
in your own browser via injected CSS/JS. This is the same class of technique used
by uBlock Origin's cosmetic filters — see [`docs/architecture.md`](docs/architecture.md)
for the full technical breakdown.

> Scope: this runs only in your own browser, on pages you visit, and changes only
> what _you_ see. It does not attack, probe, or send data to any third party.

## Stack

- **[WXT](https://wxt.dev)** — Vite-based extension framework, TypeScript-first,
  cross-browser (Chrome / Firefox / Edge), HMR dev mode.
- **Manifest V3** with `declarativeNetRequest`, `scripting`, and `storage`.
- Two content-script layers: an **ISOLATED** cosmetic layer and an optional
  **MAIN**-world anti-detection scriptlet.

## Quick start

```bash
npm install        # installs deps and runs `wxt prepare` (generates .wxt/ types)
npm run dev        # launches Chrome with HMR
npm run dev:firefox

npm run build      # production build into .output/
npm run zip        # packaged .zip for the stores
npm run compile    # type-check only (tsc --noEmit)

npm run gate       # all quality gates: format, lint, type-check, test, build
npm test           # vitest unit/integration suite
```

Quality gates (format, lint, type-check, tests, build) are enforced in CI on
every push and PR — see [`docs/gates.md`](docs/gates.md).

Load the unpacked build (`.output/chrome-mv3/`) via `chrome://extensions` →
Developer mode → "Load unpacked". See [`docs/development.md`](docs/development.md).

## Dependencies & security

All deps are kept on their latest releases. A few transitive **dev-only**
packages (pulled in by `wxt` / `web-ext-run`) shipped known CVEs, so
`package.json` pins them to patched versions via `overrides`:

```json
"overrides": {
  "shell-quote": "^1.8.4",
  "tar": "^7.5.16",
  "tmp": "^0.2.7",
  "uuid": "^14.0.0"
}
```

This clears 8 of the 12 advisories `npm audit` originally reported. The
remaining 4 are a single `esbuild` advisory (GHSA-gv7w-rqvm-qjhr) counted once
each for `esbuild → vite → vite-node → wxt`. Its fix (`esbuild@0.28.1`) is **not
yet compatible** with the `vite@6` that `vitest`/`wxt` use, and forcing it
breaks the build — so it is intentionally left unpinned. It is a build-time
dependency (never shipped in the extension) and the advisory concerns esbuild's
Deno install path, not the npm build, so real-world risk is negligible. Drop the
esbuild concern by bumping `vite`/`vitest` once they support esbuild 0.28+.

Re-check anytime with `npm audit`.

## Project layout

```
wxt.config.ts            Manifest + build config
entrypoints/
  background.ts          MV3 service worker (defaults + Anthropic API call)
  content.ts             ISOLATED world: CSS inject, MutationObserver, AI cleanup
  main-world.content.ts  MAIN world: anti-adblock-detection scriptlet
  popup/                 Toolbar popup UI (toggle, selectors, AI cleanup)
lib/
  settings.ts            Typed settings (sync) + API key (local)
  hider.ts               Cosmetic filter engine (stylesheet + observer)
  detect.ts              Shared types for the AI cleanup detector
  digest.ts              Builds the compact page digest sent to the model
  anthropic.ts           Claude Haiku call (on-demand element detection)
assets/hider.css         Static, always-on cosmetic rules
public/rules.json        declarativeNetRequest network rules (trackers)
docs/                    Architecture, development, AI detector, roadmap
```

## On-demand AI cleanup

The popup's **"Clean up this page (AI)"** button asks Claude Haiku to pick clutter
to hide — a user-triggered authoring assist, not a runtime path. Bring your own
Anthropic API key (stored locally, never synced). See
[`docs/ai-detector.md`](docs/ai-detector.md).

## Roadmap & backlog

The full development lifecycle — from this scaffold through store release and
maintenance — is in [`docs/roadmap.md`](docs/roadmap.md).

The roadmap is broken into tracked tasks with **[Backlog.md](https://backlog.md)**,
a git-native Markdown task manager. Tasks live in `backlog/tasks/` (versioned with
the code); a rendered board snapshot is in
[`backlog/Board.md`](backlog/Board.md). Definition of Done for every task is the
green [quality gates](docs/gates.md).

```bash
npx backlog board        # Kanban board in the terminal
npx backlog browser      # web UI (http://localhost:6420)
npx backlog task list --plain
npx backlog board export backlog/Board.md   # refresh the committed snapshot
```
