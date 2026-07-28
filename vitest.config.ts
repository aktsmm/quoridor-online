import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    // The exhaustive wall/jump suites are CPU bound rather than IO bound.
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
    },
  },
});
