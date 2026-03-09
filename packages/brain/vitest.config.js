import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
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
    isolate: true,    // 待全部 Batch 完成后切换为 false（Batch 2 已完成，Batch 3-6 待处理）
    pool: 'forks',
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: 5  // 防止 OOM：isolate:false 下每个 worker 内部共享，5 个 fork 足够
      }
    }
  }
});
