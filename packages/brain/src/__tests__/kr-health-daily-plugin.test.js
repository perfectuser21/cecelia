/**
 * kr-health-daily-plugin.test.js — D1.7c plugin 单测
 *
 * 用 loadHealth 注入避免 dynamic import('./kr-verifier.js') 实际跑（kr-verifier 依赖 db.js）
 */
import { describe, it, expect, vi } from 'vitest';
import { tick } from '../kr-health-daily-plugin.js';

function makeTickState(last = 0) {
  return { lastKrHealthDailyTime: last };
}

describe('kr-health-daily-plugin', () => {
  it('throttled → skipped', async () => {
    const ts = makeTickState(Date.now() - 1000);
    const r = await tick({ tickState: ts, intervalMs: 24 * 60 * 60 * 1000 });
    expect(r).toEqual({ skipped: true, reason: 'throttled' });
  });

  it('healthy 全部 → 返回 kr_health_check action 且 issues_count=0', async () => {
    const loadHealth = async () => ({
      summary: { healthy: 3, warn: 0, critical: 0 },
      verifiers: [
        { kr_title: 'A', health: 'healthy', issues: [] },
        { kr_title: 'B', health: 'healthy', issues: [] },
      ],
    });
    const r = await tick({ tickState: makeTickState(0), intervalMs: 0, loadHealth });
    expect(r.action).toBe('kr_health_check');
    expect(r.summary.healthy).toBe(3);
    expect(r.issues_count).toBe(0);
  });

  it('warn/critical 存在 → issues_count > 0 + console.warn 被调', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loadHealth = async () => ({
      summary: { healthy: 1, warn: 1, critical: 1 },
      verifiers: [
        { kr_title: 'OK', health: 'healthy', issues: [] },
        { kr_title: 'W', health: 'warn', issues: ['stale_data'] },
        { kr_title: 'C', health: 'critical', issues: ['constant_sql', 'no_source'] },
      ],
    });
    const r = await tick({ tickState: makeTickState(0), intervalMs: 0, loadHealth });
    expect(r.issues_count).toBe(2);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toMatch(/WARN/);
    expect(warn.mock.calls[1][0]).toMatch(/CRITICAL/);
    warn.mockRestore();
  });

  it('loadHealth 抛错 → 返回 { error }', async () => {
    const loadHealth = async () => { throw new Error('verifier offline'); };
    const r = await tick({ tickState: makeTickState(0), intervalMs: 0, loadHealth });
    expect(r.error).toBe('verifier offline');
  });

  it('tickLog 被调 + tickState 更新', async () => {
    const tickLog = vi.fn();
    const ts = makeTickState(0);
    const before = Date.now();
    const loadHealth = async () => ({
      summary: { healthy: 5, warn: 0, critical: 0 },
      verifiers: [],
    });
    await tick({ tickState: ts, tickLog, intervalMs: 0, loadHealth });
    expect(tickLog).toHaveBeenCalledWith(expect.stringContaining('KR 可信度日巡检'));
    expect(ts.lastKrHealthDailyTime).toBeGreaterThanOrEqual(before);
  });
});
