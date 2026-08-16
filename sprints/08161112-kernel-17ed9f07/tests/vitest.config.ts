import { defineConfig } from 'vitest/config';

// Sprint-local vitest config: brain's root config restricts `include` to
// src/** and tests/**, so the GAN red-tests under this sprint dir are never
// collected by the default project config. This config includes exactly the
// sprint contract tests. Run from packages/brain so 'vitest' + deps resolve:
//   cd packages/brain && npx vitest run \
//     --config ../../sprints/08161112-kernel-17ed9f07/tests/vitest.config.ts
export default defineConfig({
  test: {
    root: __dirname,
    include: ['**/*.test.ts'],
    environment: 'node',
  },
});
