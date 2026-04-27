import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['sprints/tests/ws*/*.test.ts'],
    root: process.cwd(),
  },
});
