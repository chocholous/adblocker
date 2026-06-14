// happy-dom doesn't always provide CSS.escape; polyfill a minimal version so
// selector-generation code under test runs the same as in a real browser.
type CssGlobal = { escape: (value: string) => string };
const g = globalThis as unknown as { CSS?: CssGlobal };
if (typeof g.CSS === 'undefined') {
  g.CSS = {
    escape: (value: string) =>
      String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`),
  };
}
