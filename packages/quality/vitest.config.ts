import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Exclude integration tests that require local environment.
    // Only run unit tests in tests/devgate/ and tests/hooks/ (unit subset).
    // Run the following locally after setting up the environment:
    // - tests/*.test.ts:           root-level integration tests (worker, gateway, heartbeat, queue, e2e)
    // - tests/api/**:              needs running API server at localhost:5220
    // - tests/gate/**:             needs cleanup.sh, regression-contract.yaml, and local files
    // - pr-gate-phase1.test.ts:    needs regression-contract.yaml with specific IDs and monorepo paths
    // - pr-gate-phase2.test.ts:    needs PRD/DoD files in working directory
    // - install-hooks.test.ts:     needs hook-core directory from install-hooks.sh
    exclude: [
      'tests/*.test.ts',
      'tests/api/**',
      'tests/gate/**',
      'tests/hooks/install-hooks.test.ts',
      'tests/hooks/pr-gate-phase1.test.ts',
      'tests/hooks/pr-gate-phase2.test.ts',
      '**/node_modules/**',
    ],
  },
});
