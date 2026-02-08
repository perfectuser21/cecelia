import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // 串行执行测试文件，避免并发时 git/shell 命令竞争
    fileParallelism: false,
    // 排除standalone CommonJS测试脚本（由wrapper.test.ts调用）
    exclude: ['**/node_modules/**', '**/devgate-fake-test-detection.test.cjs'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
      // 覆盖率阈值（暂时设低，后续逐步提高）
      thresholds: {
        statements: 50,
        branches: 50,
        functions: 50,
        lines: 50,
      },
    },
  },
});
