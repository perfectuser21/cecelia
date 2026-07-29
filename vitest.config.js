import { defineConfig } from 'vitest/config';

// 根目录 vitest 配置：用于 harness CI Sprint Tests 跑 sprints/**/*.test.ts，
// 以及 brain CI 防线的 skill 契约测试 packages/brain/scripts/ci/__tests__/**。
//
// 改为「显式 include 两个真实根」而非「默认 include + 排除 packages/**」的原因：
//   - skill 契约测试固定落在 packages/brain/scripts/ci/__tests__/（合同约定路径），
//     从仓库根跑 `npx vitest run packages/brain/scripts/ci/__tests__/skill-contract.test.mjs`
//     时，旧的 `exclude: packages/**` 会把它过滤掉（No test files found），合同 Step2 无法验证。
//   - 显式 include 只展开仓库根 sprints 与该 ci 目录，不会扫描 packages/**，
//     因此不会重复发现同一 sprint 测试，保留原去重意图。
//   - packages/brain 自身的单元/集成测试仍由 packages/brain/vitest.config.js 负责，互不影响。
export default defineConfig({
  test: {
    include: [
      'sprints/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'packages/brain/scripts/ci/__tests__/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'tests/regression/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'tests/**/*.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    exclude: [
      'sprints/archive/**',
      'node_modules/**',
      '**/node_modules/**',
      '**/dist/**',
    ],
  },
});
