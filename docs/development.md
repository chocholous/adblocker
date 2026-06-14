# Development guide

## Prerequisites

- Node.js ≥ 20 (developed on 22)
- npm ≥ 10
- Chrome / Chromium (and optionally Firefox) for manual testing

## Install & generate types

```bash
npm install
```

`postinstall` runs `wxt prepare`, which generates `.wxt/` (types + the
`#imports` virtual module). If your editor shows red squiggles on `#imports`,
`@/...`, or `defineContentScript`, run `npx wxt prepare` once.

## Day-to-day commands

| Command                 | Purpose                                    |
| ----------------------- | ------------------------------------------ |
| `npm run dev`           | Launch Chrome with hot-module reload       |
| `npm run dev:firefox`   | Same, in Firefox                           |
| `npm run build`         | Production build → `.output/chrome-mv3/`   |
| `npm run build:firefox` | Production build → `.output/firefox-mv2/`  |
| `npm run zip`           | Store-ready `.zip`                         |
| `npm run compile`       | Type-check only (`tsc --noEmit`)           |
| `npm run lint`          | ESLint (`lint:fix` to autofix)             |
| `npm run format`        | Prettier write (`format:check` to verify)  |
| `npm test`              | Vitest unit/integration suite              |
| `npm run test:e2e`      | Playwright E2E (loads the built extension) |
| `npm run gate`          | All quality gates in sequence              |

## Quality gates

`npm run gate` runs the full sequence (format → lint → type-check → test → build)
that CI enforces on every push and PR. See [`gates.md`](gates.md) for the gate
policy, the test layers, and the pre-release manual/user-testing gates.

## Load the unpacked extension

1. `npm run build`
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → select `.output/chrome-mv3/`.
4. Pin the toolbar icon; open the popup to toggle and edit selectors.

`npm run dev` does this automatically and reloads on save.

## Where to make changes

| Task                                  | File                                   |
| ------------------------------------- | -------------------------------------- |
| Add/adjust default selectors          | `lib/settings.ts` (`DEFAULT_SETTINGS`) |
| Change hide/remove logic, observer    | `lib/hider.ts`                         |
| ISOLATED-world behavior, world bridge | `entrypoints/content.ts`               |
| MAIN-world anti-detection scriptlets  | `entrypoints/main-world.content.ts`    |
| Network-level blocking rules          | `public/rules.json`                    |
| Permissions / manifest                | `wxt.config.ts`                        |
| Popup UI                              | `entrypoints/popup/`                   |

## Adding selectors at runtime

Open the popup and enter one CSS selector per line:

- **Hide selectors** → `display: none !important` (element stays in DOM).
- **Remove selectors** → element is detached via `.remove()`.

Changes save to `chrome.storage.sync` and apply live to open tabs through
`settingsItem.watch()` in `content.ts`.

## Adding a MAIN-world scriptlet

MAIN-world code runs in the page context with **no `chrome.*` access**. Pass any
config from `content.ts` via the existing `CustomEvent('sch:config')` bridge, and
keep the scriptlet defensive (wrap risky property patches in `try/catch`).

## Icons

No custom icons are bundled yet; WXT uses a default. To add them, drop
`public/icon/16.png`, `32.png`, `48.png`, `128.png` (WXT auto-detects), or
configure `manifest.icons` in `wxt.config.ts`.

## Troubleshooting

- **`#imports` / `@/` unresolved** → `npx wxt prepare`.
- **DNR rule rejected** → validate `public/rules.json` against the
  [declarativeNetRequest rule format](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#rules).
- **Cosmetic rule flickers** → ensure the selector is in the static/dynamic CSS
  path, not only the `MutationObserver` (observers fire after insertion).
