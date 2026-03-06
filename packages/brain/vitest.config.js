import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html', 'json'],
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
        statements: 20,
        branches: 10,
        functions: 0,
        lines: 0,
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
    isolate: true,
    pool: 'forks'
  }
});