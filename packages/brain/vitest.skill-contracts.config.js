import { defineConfig } from 'vitest/config';

// Dedicated config for skill-contracts tests.
// Used by the skill-tests CI job: cd packages/brain && npx vitest run tests/skill-contracts/ --config vitest.skill-contracts.config.js
// Kept separate from vitest.config.js so brain-unit shard distribution stays stable.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/skill-contracts/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: 2,
      },
    },
  },
});
