import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing';

export default defineConfig({
  // WxtVitest wires WXT's path aliases and points `wxt/browser` at an in-memory
  // fake browser (storage, runtime, …). lib/settings defines a versioned,
  // migrated storage item at import time, so without this the module crashes on
  // a missing extension runtime.
  plugins: [WxtVitest()],
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
});
