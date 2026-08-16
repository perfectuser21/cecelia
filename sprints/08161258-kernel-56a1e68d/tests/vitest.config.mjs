// 自包含配置：sprint TDD red 用。evaluator 的权威回归 oracle 是 packages/brain 内源测试文件
// （见 contract-dod.md BEHAVIOR），本配置只跑本目录 red 证明。
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    root: '/workspace/sprints/08161258-kernel-56a1e68d/tests',
    include: ['*.test.mjs'],
  },
});
