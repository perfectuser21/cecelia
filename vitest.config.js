import { defineConfig } from 'vitest/config';

// 根目录 vitest 配置：仅用于 harness CI Sprint Tests 跑 sprints/**/*.test.ts
// packages/brain 自身的测试由 packages/brain/vitest.config.js 负责（npm test -w packages/brain）
// 此配置排除 packages/** 防止 packages/brain/sprints 符号链接导致同一测试文件被发现两次

// Sprint tests at sprints/*/tests/*.test.ts（非 tests/ws{N}/ 子目录）使用
// join(__dirname, '../../../..')，但该深度只需 3 层才能到 repo root。
// 这个 plugin 在 vite-node transform 阶段修正路径，不修改测试文件内容。
const fixSprintRepoRootPlugin = {
  name: 'fix-sprint-test-repo-root',
  enforce: 'pre',
  transform(code, id) {
    if (/\/sprints\/[^/]+\/tests\/[^/]+\.test\.[jt]sx?$/.test(id)) {
      const pattern = "join(__dirname, '../../../..')";
      if (code.includes(pattern)) {
        process.stderr.write(`[fix-sprint-repo-root] patching ${id}\n`);
        const fixed = code.replace(pattern, "join(__dirname, '../../..')");
        return { code: fixed, map: null };
      }
    }
  },
};

export default defineConfig({
  plugins: [fixSprintRepoRootPlugin],
  test: {
    exclude: [
      'packages/**',
      'apps/**',
      'node_modules/**',
      '**/node_modules/**',
      '**/dist/**',
    ],
  },
});
