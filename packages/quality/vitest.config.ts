import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Exclude integration tests that require local environment (running server or local hooks setup)
    // Run manually with proper setup: API_BASE=http://... npx vitest run tests/api
    // Or: npx vitest run tests/hooks/install-hooks.test.ts (after running install-hooks.sh)
    exclude: [
      'tests/api/**',
      'tests/hooks/install-hooks.test.ts',
      '**/node_modules/**',
    ],
  },
});
