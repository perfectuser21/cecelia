/**
 * crystal-judge.test.js — 判官 job 配对测试(lint-test-pairing)
 * 只验 job 层契约:导出存在、自带窗口 gate(非窗口期跳过不触库)。
 * 聚合/判决的深断言在 crystal/__tests__ 与 sprint 冻结测试里。
 */
import { describe, it, expect, vi } from 'vitest';
import { maybeRunCrystalJudge } from '../crystal-judge.js';

describe('maybeRunCrystalJudge', () => {
  it('导出为可调用函数(scheduler JOBS 注册面)', () => {
    expect(typeof maybeRunCrystalJudge).toBe('function');
  });
  it('非北京05:00窗口 → 跳过且不触库(自 gate,scheduler 60s 轮询安全)', async () => {
    const pool = { query: vi.fn() };
    // 窗口=UTC 21:00-21:05(北京 05:00);UTC 04:00 远离窗口
    const r = await maybeRunCrystalJudge(pool, new Date('2026-09-06T04:00:00.000Z'));
    expect(r.triggered).toBe(false);
    expect(r.reason).toBe('outside_window');
    expect(pool.query).not.toHaveBeenCalled();
  });
});
