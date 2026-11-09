import { defineConfig } from 'vitest/config';
import {skillSourceExcludes} from './scripts/ci/skill-source-tests.mjs';

// 根目录回归入口；Brain自身测试由其组件配置选择，外置Skill正文走固定来源专项。
export default defineConfig({
  test: {
    include: [
      'sprints/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'packages/brain/scripts/ci/__tests__/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'tests/regression/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'tests/**/*.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    exclude: [
      ...skillSourceExcludes('root'),
      'sprints/archive/**',
      'node_modules/**',
      '**/node_modules/**',
      '**/dist/**',
    ],
  },
});
