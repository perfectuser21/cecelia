import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['sprints/tests/**/*.test.js'],
    testTimeout: 30000,
    pool: 'forks',
  },
});
