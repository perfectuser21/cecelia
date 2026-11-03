import { defineConfig } from 'vitest/config';
import { validateMcpPgFixtureTarget } from './__tests__/helpers/mcp-pg-fixture.js';

// 显式PG跑道缺配置即失败，不能把未执行的用例记为通过。
validateMcpPgFixtureTarget(process.env.TEST_DATABASE_URL);

export default defineConfig({ test: {
  environment: 'node', include: ['__tests__/integration/**/*.pg.test.js'],
  exclude: ['**/node_modules/**'], fileParallelism: false,
  testTimeout: 10000, hookTimeout: 30000,
} });
