import { defineConfig } from 'vitest/config';

// Sprint 合同测试用最小配置：
// - 只 include 当前 sprint 的 tests/wsN/*.{test,spec}.{js,ts}
// - 不继承 brain 包的 mock / 大量 exclude，避免 cross-package 污染合同对抗
// - pool: 'forks' + singleFork:true：vitest 默认 worker 线程不支持 process.chdir()，
//   build-info 的 cwd-drift 测试需要 chdir，必须用 child_process forks
//   （node:worker_threads 限制 chdir 是为了防止 worker 间状态污染主进程；
//   forks 模式每个测试文件是独立子进程，chdir 安全）。
// 跑法：cd sprints && npx vitest run --config ./vitest.config.js
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/ws*/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    testTimeout: 15000,
    hookTimeout: 15000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
