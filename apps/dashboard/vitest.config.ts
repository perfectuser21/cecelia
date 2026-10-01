import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { createRequire } from 'node:module';

// npm 可将依赖提升到根目录或装进 workspace；按 Dashboard 实际依赖树定位。
const dashboardRequire = createRequire(path.resolve(__dirname, 'package.json'));
const routerRequire = createRequire(dashboardRequire.resolve('react-router-dom/package.json'));

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    server: {
      deps: {
        // 让 react-markdown 走 vite transform 管道（应用下方 react alias），
        // 否则它会被 optimizeDeps 预打包并把根部 React 19 烘焙进去 → 与 dashboard React 18 撞车
        inline: [/react-router/, /lucide-react/, /react-markdown/, /remark-/, /micromark/, /mdast/, /hast/, /unist/, /vfile/, /unified/, /property-information/, /space-separated-tokens/, /comma-separated-tokens/, /html-url-attributes/, /devlop/, /trim-lines/, /decode-named-character-reference/, /character-entities/, /ccount/, /escape-string-regexp/, /markdown-table/, /zwitch/, /longest-streak/, /bail/, /is-plain-obj/, /extend/, /estree-util-is-identifier-name/],
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@features/core': path.resolve(__dirname, '../api/features'),
      // 强制 React 单实例（含 react/jsx-runtime 子路径），锁到 dashboard 本地 React 18。
      // 否则 monorepo 会把 react-markdown 的 react peer 提升到根（React 19），
      // 与组件用的 React 18 撞车 → "Objects are not valid as a React child"。
      react: path.dirname(dashboardRequire.resolve('react/package.json')),
      'react-dom': path.dirname(dashboardRequire.resolve('react-dom/package.json')),
      'react-router-dom': dashboardRequire.resolve('react-router-dom/dist/index.js'),
      'react-router': routerRequire.resolve('react-router/dist/index.js'),
      'lucide-react': dashboardRequire.resolve('lucide-react/dist/esm/lucide-react.js'),
    },
    dedupe: ['react', 'react-dom', 'react-router-dom'],
  },
});
