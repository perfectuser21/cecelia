import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'sprints/07280225-kernel-fleet-durable-recovery-r5/tests/durable-recovery.contract.test.ts',
    ],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
