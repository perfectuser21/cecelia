import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Exclude integration tests that require a running server
    // Run with: API_BASE=http://... npx vitest run tests/api to include them
    exclude: [
      'tests/api/**',
      '**/node_modules/**',
    ],
  },
});
