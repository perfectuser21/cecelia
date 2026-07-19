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
      // scope tightly to the 区段 C "never started" SELECT — section A also has
      // NOT EXISTS + initiative_runs in its subquery, but only 区段 C also filters
      // on t.claimed_at, so require that too to avoid cross-matching section A.
      if (/SELECT/i.test(sql) && /NOT\s+EXISTS/i.test(sql) && /initiative_runs/.test(sql) && /claimed_at/i.test(sql)) {
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

  // ── 容器存活探测（07-19 bug fix）────────────────────────────────────────
  // 真实事故：本次对话内实测复现4次——claude-headed-smoke/GP-A补齐触发入口/
  // 两次headless-smoke——都是容器慢启动或前台接管，claimed_at超过20分钟阈值
  // 但没来得及写initiative_runs首行，被区段C无差别标failed、清空claim，触发
  // 重新完整派发（产出多个重复PR）。修法：判死前先探测docker ps，容器还活着
  // 就不判死，留给下次tick再看——复用harness-relay-watchdog.js:331已验证过的
  // `docker ps -q --filter "name=cecelia-relay-${short}"` 模式。

  it('容器仍在跑（docker ps 探测到）→ 不判死，不清空 claim', async () => {
    const TASK_ID = 'dddd1111-2222-3333-4444-555566667777';
    let updateCalled = false;
    mockPoolQuery.mockImplementation(async (sql) => {
      if (/SELECT/i.test(sql) && /NOT\s+EXISTS/i.test(sql) && /initiative_runs/.test(sql) && /claimed_at/i.test(sql)) {
        return { rows: [{ id: TASK_ID }] };
      }
      if (/UPDATE\s+tasks/i.test(sql)) {
        updateCalled = true;
        return { rows: [{ id: TASK_ID }] };
      }
      return { rows: [] };
    });
    // 容器仍在跑：docker ps -q 返回非空容器 ID
    const execFn = vi.fn(() => 'abc123def456\n');

    const r = await resumeStalledHarnessDrivers({ execFn });

    expect(execFn).toHaveBeenCalledWith(expect.stringMatching(/docker ps -q --filter/));
    expect(updateCalled).toBe(false);
    expect(r.resumed).toEqual([]);
  });

  it('容器已退出（docker ps 探测为空）→ 保留现有判死逻辑，标 failed', async () => {
    const TASK_ID = 'eeee1111-2222-3333-4444-555566667777';
    let updateSql = '';
    mockPoolQuery.mockImplementation(async (sql) => {
      if (/SELECT/i.test(sql) && /NOT\s+EXISTS/i.test(sql) && /initiative_runs/.test(sql) && /claimed_at/i.test(sql)) {
        return { rows: [{ id: TASK_ID }] };
      }
      if (/UPDATE\s+tasks/i.test(sql)) {
        updateSql = sql;
        return { rows: [{ id: TASK_ID }] };
      }
      return { rows: [] };
    });
    // 容器已退出：docker ps -q 返回空字符串
    const execFn = vi.fn(() => '');

    const r = await resumeStalledHarnessDrivers({ execFn });

    expect(updateSql).toMatch(/status\s*=\s*'failed'/i);
    expect(r.resumed).toContain(TASK_ID);
  });

  it('docker 命令失败（不可用）→ fail-open 保留现有判死逻辑，不因探测失败而漏判真死亡任务', async () => {
    const TASK_ID = 'ffff1111-2222-3333-4444-555566667777';
    let updateSql = '';
    mockPoolQuery.mockImplementation(async (sql) => {
      if (/SELECT/i.test(sql) && /NOT\s+EXISTS/i.test(sql) && /initiative_runs/.test(sql) && /claimed_at/i.test(sql)) {
        return { rows: [{ id: TASK_ID }] };
      }
      if (/UPDATE\s+tasks/i.test(sql)) {
        updateSql = sql;
        return { rows: [{ id: TASK_ID }] };
      }
      return { rows: [] };
    });
    const execFn = vi.fn(() => { throw new Error('docker: command not found'); });

    const r = await resumeStalledHarnessDrivers({ execFn });

    expect(updateSql).toMatch(/status\s*=\s*'failed'/i);
    expect(r.resumed).toContain(TASK_ID);
  });
});
