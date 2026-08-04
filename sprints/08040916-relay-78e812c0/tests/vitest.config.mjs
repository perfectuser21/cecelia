// vitest.config.mjs — 本 sprint 合同测试专用配置
// 用法: cd packages/brain && npx vitest run --config ../../sprints/08040916-relay-78e812c0/tests/vitest.config.mjs
// DB: vitest 环境下 db-config.js 强制 cecelia_test（首次先跑 bash packages/brain/scripts/setup-test-db.sh）
import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
