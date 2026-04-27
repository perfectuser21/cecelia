import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    testTimeout: 15000,
    pool: 'forks',
    poolOptions: { forks: { minForks: 1, maxForks: 1 } },
  },
});
