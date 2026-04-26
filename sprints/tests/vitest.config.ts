import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['ws*/**/*.test.ts'],
    testTimeout: 30000,
  },
});
