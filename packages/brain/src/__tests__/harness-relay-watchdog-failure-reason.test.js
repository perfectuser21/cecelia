/**
 * harness-relay-watchdog-failure-reason.test.js
 *
 * 缺口：task 已 failed 时 watchdog 把 initiative_runs 收敛成 phase='failed'，
 * 但这条 UPDATE 是唯一一条没写 failure_reason 的（旁边四条同类 UPDATE 都写了），
 * 界面上这类 run 的失败原因永远是空的 —— 事故 51836fb2 复盘时就卡在这。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../notifier.js', () => ({ sendBark: vi.fn().mockResolvedValue(true) }));

import { resumeStalledRelayRuns } from '../harness-relay-watchdog.js';

const TASK_ID = '51836fb2-10ea-48eb-97b2-c324df32d147';

function makePool(taskStatus) {
  const pool = { query: vi.fn() };
  pool.query.mockImplementation(async (sql) => {
    const s = String(sql);
    if (/DISTINCT ON \(initiative_id\)/.test(s)) {
      return {
        rows: [{
          id: 'run-1', initiative_id: TASK_ID, current_task_id: TASK_ID,
          phase: 'generating', attempts: '1',
          deadline_at: new Date(Date.now() + 3600e3).toISOString(),
          pr_url: null, orchestrator_host: 'kernel-v1',
        }],
      };
    }
    if (/FROM tasks/.test(s)) {
      return { rows: [{ id: TASK_ID, status: taskStatus, title: 't', pr_url: null, payload: {} }] };
    }
    return { rows: [] };
  });
  return pool;
}

const runFailUpdates = (pool) => pool.query.mock.calls
  .filter(([sql]) => /UPDATE initiative_runs/.test(String(sql)) && /phase='failed'/.test(String(sql)));

beforeEach(() => vi.clearAllMocks());

describe('task failed → initiative_runs 收敛必须带 failure_reason', () => {
  it('写入有意义的 failure_reason（task_failed_upstream），不再留空', async () => {
    const pool = makePool('failed');
    const out = await resumeStalledRelayRuns({ pool, execFn: vi.fn(() => '') });
    expect(out.housekept).toBe(1);
    const updates = runFailUpdates(pool);
    expect(updates.length).toBe(1);
    expect(String(updates[0][0])).toContain('failure_reason');
    expect(String(updates[0][0])).toContain('task_failed_upstream');
  });

  it('已有更具体的 failure_reason 时不覆盖（COALESCE 保留上游诊断）', async () => {
    const pool = makePool('failed');
    await resumeStalledRelayRuns({ pool, execFn: vi.fn(() => '') });
    expect(String(runFailUpdates(pool)[0][0])).toContain('COALESCE(failure_reason');
  });

  it('回归锁:task completed 走 done 分支，不写 failed failure_reason', async () => {
    const pool = makePool('completed');
    const out = await resumeStalledRelayRuns({ pool, execFn: vi.fn(() => '') });
    expect(out.housekept).toBe(1);
    expect(runFailUpdates(pool).length).toBe(0);
  });
});
