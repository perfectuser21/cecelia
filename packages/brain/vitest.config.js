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
    isolate: true,    // isolate:true — 每个测试文件独立模块注册表，消除跨文件 mock 污染
    pool: 'forks',
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: 2,   // isolate:true + coverage 内存开销大，限制 2 个 fork 防 OOM
        execArgv: ['--max-old-space-size=4096']  // 每个 fork 最多 4GB，避免 OOM 崩溃
      }
    }
  }
});
