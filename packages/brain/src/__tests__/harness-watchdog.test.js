/**
 * harness-watchdog.test.js — 单元测试 scanStuckHarness。
 *
 * 配套 lint-test-pairing 要求：packages/brain/src/harness-watchdog.js 必须
 * 有同目录或 __tests__/ 下 .test.js。
 *
 * 完整集成测试见 tests/integration/harness-watchdog-tick.test.js。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPoolQuery = vi.hoisted(() => vi.fn());

vi.mock('../db.js', () => ({
  default: { query: mockPoolQuery },
}));

let scanStuckHarness;

beforeEach(async () => {
  vi.resetModules();
  mockPoolQuery.mockReset();
  const mod = await import('../harness-watchdog.js');
  scanStuckHarness = mod.scanStuckHarness;
});

describe('scanStuckHarness — 单元 smoke', () => {
  it('export 存在并是函数', () => {
    expect(typeof scanStuckHarness).toBe('function');
  });

  it('SELECT 无 overdue → flagged 空', async () => {
    mockPoolQuery.mockImplementation(async (sql) => {
      if (/SELECT\s+initiative_id/i.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    const r = await scanStuckHarness({});
    expect(r.flagged).toEqual([]);
    expect(r.scanned).toBe(0);
  });

  it('SQL 含 phase IN A_planning/B_task_loop/C_final_e2e + deadline_at < NOW()', async () => {
    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
    await scanStuckHarness({});
    const sql = mockPoolQuery.mock.calls[0]?.[0] || '';
    expect(sql).toMatch(/A_planning/);
    expect(sql).toMatch(/B_task_loop/);
    expect(sql).toMatch(/C_final_e2e/);
    expect(sql).toMatch(/deadline_at\s*<\s*NOW/i);
    expect(sql).toMatch(/completed_at\s+IS\s+NULL/i);
  });
});
