import { defineConfig } from 'vitest/config';

// 无 shell/exec/spawn 依赖的测试文件 — 可并行
const PARALLEL_TESTS = [
  'tests/ci/known-failures-expiry.test.ts',
  'tests/ci/known-failures.test.ts',
  'tests/ci/scan-rci-coverage.test.ts',
  'tests/dev/checklist.test.ts',
  'tests/dev/dev-step-files.test.ts',
  'tests/dev/step-expectations.test.ts',
  'tests/devgate/check-changed-coverage.test.ts',
  'tests/devgate/l2b-check.test.ts',
  'tests/devgate/snapshot-prd-dod.test.ts',
  'tests/scripts/cleanup.test.ts',
  'tests/scripts/stop-cleanup-bugfixes.test.ts',
  'tests/skills/language-rule.test.ts',
  'tests/stop-hook-flow-test.test.ts',
  'tests/utils/mathUtils.test.ts',
  'tests/workflow-guard-2.test.ts',
  'tests/workflow-guard-3.test.ts',
  'tests/workflows/ci-timeout.test.ts',
  'src/index.test.ts',
];

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // 排除standalone CommonJS测试脚本（由wrapper.test.ts调用）
    exclude: ['**/node_modules/**', '**/devgate-fake-test-detection.test.cjs', '**/.claude/worktrees/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      reportsDirectory: './coverage',
      // 覆盖率阈值（暂时设低，后续逐步提高）
      thresholds: {
        statements: 50,
        branches: 50,
        functions: 50,
        lines: 50,
      },
    },
    // 使用 projects 将测试分为两组：
    // 1. parallel: 无 shell 依赖，并行运行
    // 2. serial: 有 git/shell 命令竞争，串行运行（singleFork）
    projects: [
      {
        test: {
          name: 'parallel',
          globals: true,
          environment: 'node',
          include: PARALLEL_TESTS,
          // fileParallelism 默认为 true，无需显式设置
        },
      },
      {
        test: {
          name: 'serial',
          globals: true,
          environment: 'node',
          // 排除并行组的文件，其余全部串行运行
          include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
          exclude: [
            '**/node_modules/**',
            '**/devgate-fake-test-detection.test.cjs',
            '**/.claude/worktrees/**',
            ...PARALLEL_TESTS,
          ],
          poolOptions: {
            forks: {
              // 强制使用单个 fork，避免 git/shell 命令竞争
              singleFork: true,
            },
          },
        },
      },
    ],
  },
});
