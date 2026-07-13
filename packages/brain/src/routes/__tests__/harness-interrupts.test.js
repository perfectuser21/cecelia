/**
 * routes/harness-interrupts.test.js — exact-name pairing stub for lint-test-pairing
 *
 * 此文件做模块结构断言（路由方法 + 路径注册），不接 DB / 真 LangGraph。
 *
 * 注（刀4阶段3 Task 3，2026-07-09）：原"使用 LangGraph Command 类型（Command resume）"
 * 用例已删除——该断言测的是 resume 用 harness-initiative.graph.js 重新 stream 的死代码，
 * interrupt_pending 事件只由该死图写入，orchestrator 硬校验落地后不再产生，resume 分支
 * 物理不可达，已随之物理删除（不再 import @langchain/langgraph 的 Command）。
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
});
