/**
 * harness-watchdog-tick.test.js — W3 验证（兜底 tick 扫描）
 *
 * Spec: docs/superpowers/specs/2026-05-06-harness-langgraph-reliability-design.md §W3
 *
 * 验证：scanStuckHarness 标 deadline_at < NOW() 且 completed_at IS NULL 的 initiative_run
 *       为 phase=failed, failure_reason=watchdog_overdue。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPoolQuery = vi.hoisted(() => vi.fn());

vi.mock('../../packages/brain/src/db.js', () => ({
  default: { query: mockPoolQuery },
}));

let scanStuckHarness;

beforeEach(async () => {
  vi.resetModules();
  mockPoolQuery.mockReset();
  const mod = await import('../../packages/brain/src/harness-watchdog.js');
  scanStuckHarness = mod.scanStuckHarness;
});

describe('scanStuckHarness（W3 兜底扫描）', () => {
  it('找到 1 条 overdue → 标 failed 并返回 flagged 列表', async () => {
    const overdue = {
      initiative_id: 'aaaa1111-2222-3333-4444-555566667777',
      contract_id: 'bbbb1111-2222-3333-4444-555566667777',
      deadline_at: new Date(Date.now() - 60_000),
      phase: 'B_task_loop',
    };

    let updateCalled = false;
    mockPoolQuery.mockImplementation(async (sql) => {
      if (/SELECT\s+initiative_id/i.test(sql)) {
        return { rows: [overdue] };
      }
      if (/UPDATE\s+initiative_runs[\s\S]*failure_reason/i.test(sql)) {
        updateCalled = true;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });

    const r = await scanStuckHarness({});
    expect(r.flagged).toContain(overdue.initiative_id);
    expect(r.scanned).toBe(1);
    expect(updateCalled).toBe(true);
  });

  it('notifier 提供时被调用并 P1 alert', async () => {
    const overdue = {
      initiative_id: 'cccc1111-2222-3333-4444-555566667777',
      contract_id: 'dddd1111-2222-3333-4444-555566667777',
      deadline_at: new Date(Date.now() - 120_000),
      phase: 'A_planning',
    };
    mockPoolQuery.mockImplementation(async (sql) => {
      if (/SELECT\s+initiative_id/i.test(sql)) return { rows: [overdue] };
      return { rows: [] };
    });

    const send = vi.fn().mockResolvedValue();
    const r = await scanStuckHarness({ notifier: { send } });
    expect(r.flagged.length).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].priority).toBe('P1');
  });

  it('无 overdue → flagged 空数组', async () => {
    mockPoolQuery.mockImplementation(async (sql) => {
      if (/SELECT\s+initiative_id/i.test(sql)) return { rows: [] };
      return { rows: [] };
    });

    const r = await scanStuckHarness({});
    expect(r.flagged.length).toBe(0);
    expect(r.scanned).toBe(0);
  });
});
