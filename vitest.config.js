import { defineConfig } from 'vitest/config';

// 根目录 vitest 配置：仅用于 harness CI Sprint Tests 跑 sprints/**/*.test.ts
// packages/brain 自身的测试由 packages/brain/vitest.config.js 负责（npm test -w packages/brain）
// 此配置排除 packages/** 防止 packages/brain/sprints 符号链接导致同一测试文件被发现两次
export default defineConfig({
  test: {
    exclude: [
      'packages/**',
      'apps/**',
      'node_modules/**',
      '**/node_modules/**',
      '**/dist/**',
    ],
  },
});
