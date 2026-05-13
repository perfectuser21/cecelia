import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['ws1/**/*.test.ts'],
    root: import.meta.dirname,
  },
});
