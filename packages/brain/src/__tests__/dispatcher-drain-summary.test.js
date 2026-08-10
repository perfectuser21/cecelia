/**
 * dispatcher-drain-summary.test.js — 排空生效期间的可观测兜底日志 [BEHAVIOR]
 *
 * PRD 需求 4：排空生效期间派发器至少每 N 轮打印一次汇总日志（已排空时长 + 被挡候选数），
 * 避免「日志里什么都没有」的排障黑洞（事故：dispatcher.js 每轮直接 return draining，
 * 连 slot_check 日志都不出现 → 2h20m 静默停摆）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: (...a) => mockQuery(...a) } }));

describe('dispatcher — 排空汇总日志（每 N 轮）', () => {
  let maybeLogDrainSummary, DRAIN_SUMMARY_EVERY_N, _resetDrainSummaryCounter;
  const pool = { query: (...a) => mockQuery(...a) };

  beforeEach(async () => {
    vi.resetModules();
    mockQuery.mockReset().mockResolvedValue({ rows: [{ n: 3 }] });
    const mod = await import('../dispatcher.js');
    maybeLogDrainSummary = mod.maybeLogDrainSummary;
    DRAIN_SUMMARY_EVERY_N = mod.DRAIN_SUMMARY_EVERY_N;
    _resetDrainSummaryCounter = mod._resetDrainSummaryCounter;
    _resetDrainSummaryCounter();
  });

  it('第 1 轮即打印汇总，含 [dispatch] 前缀与被挡候选数', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const r = await maybeLogDrainSummary(pool);
    expect(r.logged).toBe(true);
    expect(r.round).toBe(1);
    expect(r.blocked).toBe(3);
    const printed = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(printed).toMatch(/\[dispatch\]/);
    expect(printed).toMatch(/候选/);
    logSpy.mockRestore();
  });

  it('每 N 轮一次：第 2..N 轮不打印，第 N+1 轮再次打印', async () => {
    const N = DRAIN_SUMMARY_EVERY_N;
    expect(N).toBeGreaterThanOrEqual(1);
    const first = await maybeLogDrainSummary(pool);
    expect(first.logged).toBe(true);
    for (let i = 2; i <= N; i++) {
      const r = await maybeLogDrainSummary(pool);
      expect(r.logged).toBe(false);
    }
    const nplus1 = await maybeLogDrainSummary(pool);
    expect(nplus1.logged).toBe(true);
    expect(nplus1.round).toBe(N + 1);
  });

  it('COUNT 查询失败时不抛错，blocked 记为 null 仍打印', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await maybeLogDrainSummary(pool);
    expect(r.logged).toBe(true);
    expect(r.blocked).toBeNull();
    logSpy.mockRestore();
  });

  it('DRAIN_SUMMARY_EVERY_N 环境变量可覆盖', async () => {
    vi.resetModules();
    vi.stubEnv('DRAIN_SUMMARY_EVERY_N', '2');
    const mod = await import('../dispatcher.js');
    expect(mod.DRAIN_SUMMARY_EVERY_N).toBe(2);
    vi.unstubAllEnvs();
  });
});
