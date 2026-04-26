import { defineConfig } from 'vitest/config';

// Sprint 合同测试用最小配置：
// - 只 include 当前 sprint 的 tests/wsN/*.{test,spec}.{js,ts}
// - 不继承 brain 包的 mock / 大量 exclude，避免 cross-package 污染合同对抗
// 跑法：cd sprints && npx vitest run --config ./vitest.config.js
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/ws*/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
