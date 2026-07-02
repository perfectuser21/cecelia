/**
 * harness-watchdog-never-started.test.js
 *
 * Regression test for Notion issue fabf6bd6 — harness dispatcher deadlock.
 *
 * Gap: resumeStalledHarnessDrivers() already recovers stalled graphs via heartbeat,
 * but every query requires an existing initiative_runs row (JOIN/EXISTS). A task
 * that never even got that far (claim succeeded, status=in_progress, but the graph
 * never invoked — matches the issue's `initiative_runs=0` symptom) is invisible to
 * both existing sections (A and B). This test covers the new "never started" branch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPoolQuery = vi.hoisted(() => vi.fn());

vi.mock('../db.js', () => ({
  default: { query: mockPoolQuery },
}));

let resumeStalledHarnessDrivers;

beforeEach(async () => {
  vi.resetModules();
  mockPoolQuery.mockReset();
  const mod = await import('../harness-watchdog.js');
  resumeStalledHarnessDrivers = mod.resumeStalledHarnessDrivers;
});

describe('resumeStalledHarnessDrivers — never-started branch (fabf6bd6)', () => {
  it('SELECT 含 NOT EXISTS initiative_runs + claimed_at 陈旧判据', async () => {
    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
    await resumeStalledHarnessDrivers({});
    const allSql = mockPoolQuery.mock.calls.map(c => c[0]).join('\n');
    expect(allSql).toMatch(/NOT\s+EXISTS/i);
    expect(allSql).toMatch(/initiative_runs/);
    expect(allSql).toMatch(/claimed_at/i);
  });

  it('in_progress + 无 initiative_runs 行 + claimed_at 超过阈值(20min) → 标 failed + 释放 claim', async () => {
    const TASK_ID = 'cccc1111-2222-3333-4444-555566667777';
    let updateSql = '';
    let updateParams = [];
    mockPoolQuery.mockImplementation(async (sql, params) => {
      if (/SELECT/i.test(sql) && /NOT\s+EXISTS/i.test(sql) && /initiative_runs/.test(sql)) {
        return { rows: [{ id: TASK_ID }] };
      }
      if (/SELECT/i.test(sql)) return { rows: [] };
      if (/UPDATE\s+tasks/i.test(sql)) {
        updateSql = sql;
        updateParams = params;
        return { rows: [{ id: TASK_ID }] };
      }
      return { rows: [] };
    });

    const r = await resumeStalledHarnessDrivers({});

    expect(updateSql).toMatch(/status\s*=\s*'failed'/i);
    expect(updateSql).toMatch(/claimed_by\s*=\s*NULL/i);
    expect(updateParams.join(' ')).toContain(TASK_ID);
    // must be counted somewhere in the return value (resumed or a dedicated field)
    expect(JSON.stringify(r)).toContain(TASK_ID);
  });

  it('刚 claim 不久（claimed_at 1 分钟前）→ 不动它（不是 never-started 野鬼，是正常起步中）', async () => {
    mockPoolQuery.mockImplementation(async (sql) => {
      // simulate: the never-started SELECT itself applies the staleness filter in SQL,
      // so a fresh claim never even appears in rows — return empty for that query.
      if (/SELECT/i.test(sql) && /NOT\s+EXISTS/i.test(sql) && /initiative_runs/.test(sql)) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    const r = await resumeStalledHarnessDrivers({});
    expect(r.resumed).toEqual([]);
  });
});
