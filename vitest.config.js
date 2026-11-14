import { defineConfig } from 'vitest/config';

// 根目录回归入口；Brain自身测试由其组件配置选择，外置Skill正文不属于本仓CI验收。
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
