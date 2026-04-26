// 为 GAN 合同测试（sprints/tests/wsN/*.test.js）提供独立 vitest 配置。
// Reviewer 从 /workspace 直接运行：
//   npx vitest run -c sprints/vitest.config.js
// Generator 在合同批准后会把测试体复制到 packages/brain/src/__tests__/，
// 由 brain 自身的 vitest 运行；本配置仅服务 propose 阶段的 Red evidence 收集。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['sprints/tests/ws*/**/*.test.js'],
  },
});
