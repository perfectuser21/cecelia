import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxDev: false
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: './test/setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'test/',
        '**/*.config.ts',
        '**/index.ts',
        '**/*.d.ts',
        'dist/',
        'bin/'
      ]
    },
    include: ['features/**/*.{test,spec}.{ts,tsx}'],
    exclude: [
      'node_modules', 'dist', '.idea', '.git', '.cache',
      'tests/capture/db.test.ts',
    ]
  }
});
