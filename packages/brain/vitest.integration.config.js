import { defineConfig } from 'vitest/config';
import brainConfig, { POSTGRES_INTEGRATION_TESTS } from './vitest.config.js';

export default defineConfig({
  ...brainConfig,
  test: {
    ...brainConfig.test,
    exclude: brainConfig.test.exclude.filter(
      (testPath) => testPath !== 'src/__tests__/integration/**' && !POSTGRES_INTEGRATION_TESTS.includes(testPath),
    ),
  },
});
