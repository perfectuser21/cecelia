import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname),
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: [
      'archive/**',
      'node_modules/**',
      '**/__tests__/**',
      '**/packages/**',
      '**/apps/**',
    ],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    poolOptions: {
      forks: { minForks: 1, maxForks: 1 },
    },
  },
});
