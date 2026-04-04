import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      '../../tests/packages/brain/**/*.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    // 以下测试需要真实 PostgreSQL 连接，仅在 brain-integration CI 中运行
    exclude: [
      'src/__tests__/blocks.test.js',
      'src/__tests__/suggestion-triage.test.js',
      'src/__tests__/suggestion-integration.test.js',
      'src/__tests__/cortex-memory.test.js',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html', 'json', 'json-summary'],
      reportsDirectory: './coverage',
      include: [
        'src/**/*.js'
      ],
      exclude: [
        'src/**/*.test.js',
        'src/__tests__/**',
        'node_modules/**',
        'coverage/**'
      ],
      thresholds: {
        statements: 75,
        branches: 75,
        functions: 80,
        lines: 75,
        perFile: false
      },
      // Specific files we're tracking closely
      reportOnFailure: true,
      all: true,
      clean: true
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 30000,
    isolate: true,    // isolate:true — 每个测试文件独立模块注册表，消除跨文件 mock 污染
    pool: 'forks',
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: 3   // 3 fork 并行：每 fork 3GB = 9GB，ubuntu-latest 16GB 余量充足
      }
    }
  }
});
