/**
 * routes/harness-interrupts.test.js — exact-name pairing stub for lint-test-pairing
 *
 * 真实集成测试在 tests/integration/harness-interrupt-resume.test.ts。
 * 此文件做模块结构断言（路由方法 + 路径注册），不接 DB / 真 LangGraph。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn(),
  },
}));

describe('routes/harness-interrupts (W5)', () => {
  it('exports default Router 含 GET / 和 POST /:taskId/resume', async () => {
    const mod = await import('../harness-interrupts.js');
    const router = mod.default;
    expect(typeof router).toBe('function');
    // express Router 内部 stack 数组
    const stack = router.stack || [];
    expect(stack.length).toBeGreaterThan(0);
    const paths = stack.map((l) => l.route?.path).filter(Boolean);
    expect(paths).toContain('/');
    expect(paths.some((p) => p.includes(':taskId') && p.includes('resume'))).toBe(true);
  });

  it('使用 LangGraph Command 类型（Command resume）', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../harness-interrupts.js', import.meta.url), 'utf8');
    expect(src).toMatch(/Command\s*\(\s*\{\s*resume:/);
    expect(src).toMatch(/from\s+['"]@langchain\/langgraph['"]/);
  });
});
