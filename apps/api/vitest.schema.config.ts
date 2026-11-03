import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/capture/db.test.ts'],
    env: {API_CAPTURE_SCHEMA_INTEGRATION: '1'},
    fileParallelism: false,
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
