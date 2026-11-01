import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/system/__tests__/memory.test.ts',
      'src/system/__tests__/planning.test.ts',
      'src/system/__tests__/dev-session.test.ts',
    ],
    // No fallback DB and no conditional skip: a selected PG lane must really run.
    env: { API_PG_INTEGRATION: '1' },
    fileParallelism: false,
    testTimeout: 10000,
    hookTimeout: 15000,
  },
});
