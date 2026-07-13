import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

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
        inline: [/react-markdown/, /remark-/, /micromark/, /mdast/, /hast/, /unist/, /vfile/, /unified/, /property-information/, /space-separated-tokens/, /comma-separated-tokens/, /html-url-attributes/, /devlop/, /trim-lines/, /decode-named-character-reference/, /character-entities/, /ccount/, /escape-string-regexp/, /markdown-table/, /zwitch/, /longest-streak/, /bail/, /is-plain-obj/, /extend/, /estree-util-is-identifier-name/],
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
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
    dedupe: ['react', 'react-dom'],
  },
});
