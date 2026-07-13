/**
 * harness-watchdog-gan-stall.test.js
 *
 * P1 回归：harness liveness watchdog 漏捞 planner/GAN(A) 阶段静默卡死的 initiative。
 *
 * 根因：driver_heartbeat_at 只在 runHarnessInitiativeRouter 的 graph stream 循环里刷
 * （executor.js writeDriverHeartbeat）。planner interrupt 后 stream 结束、驱动器返回，
 * 续跑靠 planner-callback 的一次性 in-memory invoke。等容器回调这段窗口 brain 内无驱动器，
 * driver_heartbeat_at 结构性陈旧/NULL——所以 A 阶段不能单用心跳判据（否则区分不了
 * "合法等容器" vs "回调丢失永久卡死"）。
 *
 * 两次生产卡死（run b37f04a4 / 7c3a35a5）都死在 phase='A_contract'（GAN 阶段），被旧
 * watchdog 的 `ir.phase='B_task_loop'` 过滤漏掉 → execution_attempts 始终 0、10h 零活动。
 *
 * 修复：resumeStalledHarnessDrivers 新增 A 阶段复合判据——phase IN (A_contract/A_planning)
 * 且 GREATEST(driver_heartbeat_at, initiative_runs.updated_at, initiative_run_events.ts)
 * 全部静默超 staleMinutesA → fresh-start 重排（剥离 resume_from_checkpoint，让 executor 走
 * `existing && !resumeRequested` 分支重跑 planner 并递增 execution_attempts），受
 * MAX_INITIATIVE_FRESH_STARTS 上限约束。
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

// 注入 maxFreshStarts 避免单测加载 executor.js 整个依赖图
const OPTS = { maxFreshStarts: 3 };

function sqlsOf() {
  return mockPoolQuery.mock.calls.map((c) => c[0] || '');
}
function findPhaseASelect() {
  return sqlsOf().find((s) => /SELECT/i.test(s) && /A_contract/.test(s) && /GREATEST/i.test(s)) || '';
}
function findPhaseBSelect() {
  return sqlsOf().find((s) => /SELECT/i.test(s) && /B_task_loop/.test(s) && !/GREATEST/i.test(s)) || '';
}

describe('resumeStalledHarnessDrivers — A 阶段(planner/GAN) 静默卡死覆盖', () => {
  it('存在 phase A 的 SELECT：扫 A_contract + 活动静默复合判据(心跳/run/events)', async () => {
    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
    await resumeStalledHarnessDrivers(OPTS);
    const sqlA = findPhaseASelect();
    expect(sqlA).not.toBe('');
    // A 阶段 phase 取值（initiative_runs prep 写 A_contract，legacy A_planning 一并覆盖）
    expect(sqlA).toMatch(/A_contract/);
    expect(sqlA).toMatch(/harness_initiative/);
    expect(sqlA).toMatch(/in_progress/);
    // 复合活动判据三信号
    expect(sqlA).toMatch(/driver_heartbeat_at/);
    expect(sqlA).toMatch(/initiative_run_events/);
    expect(sqlA).toMatch(/GREATEST/i);
    // run_events 用 ts(bigint epoch 秒)，不是 created_at（该表无 created_at 列）
    expect(sqlA).toMatch(/\bts\b/);
    expect(sqlA).not.toMatch(/created_at/);
  });

  it('phase A 查询受 execution_attempts < MAX_INITIATIVE_FRESH_STARTS 约束', async () => {
    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
    await resumeStalledHarnessDrivers(OPTS);
    const callA = mockPoolQuery.mock.calls.find(
      (c) => /A_contract/.test(c[0] || '') && /GREATEST/i.test(c[0] || '')
    );
    expect(callA).toBeTruthy();
    expect(callA[0]).toMatch(/execution_attempts/);
    // 上限值作为参数传入（默认 = MAX_INITIATIVE_FRESH_STARTS = 3）
    expect(callA[1].map(String)).toContain('3');
  });

  it('已进入 B/C 阶段的 initiative 不被 A 判据误捞（NOT EXISTS 守卫）', async () => {
    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
    await resumeStalledHarnessDrivers(OPTS);
    const sqlA = findPhaseASelect();
    expect(sqlA).toMatch(/NOT\s+EXISTS/i);
    expect(sqlA).toMatch(/B_task_loop/);
  });

  it('A 阶段陈旧任务 → fresh-start 重排：queued + 清 claim + 剥离 resume_from_checkpoint（非 resume）', async () => {
    const TASK_ID = 'a37f04a4-1111-2222-3333-444455556666';
    let updSql = '';
    let updParams = [];
    mockPoolQuery.mockImplementation(async (sql, params) => {
      // phase B 查询无陈旧任务
      if (/SELECT/i.test(sql) && /B_task_loop/.test(sql) && !/GREATEST/i.test(sql)) {
        return { rows: [] };
      }
      // phase A 查询命中一个陈旧任务
      if (/SELECT/i.test(sql) && /A_contract/.test(sql)) {
        return { rows: [{ id: TASK_ID, execution_attempts: 0 }] };
      }
      if (/UPDATE\s+tasks/i.test(sql)) {
        updSql = sql;
        updParams = params;
        return { rows: [{ id: TASK_ID }] };
      }
      return { rows: [] };
    });
    const r = await resumeStalledHarnessDrivers(OPTS);
    expect(r.resumed).toContain(TASK_ID);
    // fresh-start = queued + 清 claim 三件套
    expect(updSql).toMatch(/status\s*=\s*'queued'/i);
    expect(updSql).toMatch(/claimed_by\s*=\s*NULL/i);
    expect(updSql).toMatch(/claimed_at\s*=\s*NULL/i);
    expect(updSql).toMatch(/started_at\s*=\s*NULL/i);
    // 原子守卫
    expect(updSql).toMatch(/status\s*=\s*'in_progress'/i);
    // 关键：A 阶段是 fresh-start 不是 resume——必须剥离 resume_from_checkpoint，
    // 让 executor 走 `existing && !resumeRequested` 分支重跑 planner + 递增 execution_attempts
    expect(updSql).toMatch(/-\s*'resume_from_checkpoint'/);
    expect(updSql).not.toMatch(/"resume_from_checkpoint":\s*true/);
    expect(updParams).toContain(TASK_ID);
  });

  it('staleMinutesA 默认 20，可配置', async () => {
    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
    await resumeStalledHarnessDrivers(OPTS);
    const callA = mockPoolQuery.mock.calls.find(
      (c) => /A_contract/.test(c[0] || '') && /GREATEST/i.test(c[0] || '')
    );
    expect(callA[1].map(String)).toContain('20');

    mockPoolQuery.mockReset();
    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
    await resumeStalledHarnessDrivers({ ...OPTS, staleMinutesA: 30 });
    const callA2 = mockPoolQuery.mock.calls.find(
      (c) => /A_contract/.test(c[0] || '') && /GREATEST/i.test(c[0] || '')
    );
    expect(callA2[1].map(String)).toContain('30');
  });

  it('phase B 既有逻辑保持不变：B_task_loop + resume_from_checkpoint=true（不破坏 #3356/#3361）', async () => {
    const TASK_B = 'b37f04a4-aaaa-bbbb-cccc-ddddeeeeffff';
    let bUpdSql = '';
    mockPoolQuery.mockImplementation(async (sql) => {
      if (/SELECT/i.test(sql) && /B_task_loop/.test(sql) && !/GREATEST/i.test(sql)) {
        return { rows: [{ id: TASK_B }] };
      }
      if (/SELECT/i.test(sql) && /A_contract/.test(sql)) return { rows: [] };
      if (/UPDATE\s+tasks/i.test(sql)) {
        bUpdSql = sql;
        return { rows: [{ id: TASK_B }] };
      }
      return { rows: [] };
    });
    const r = await resumeStalledHarnessDrivers(OPTS);
    expect(r.resumed).toContain(TASK_B);
    // phase B 仍是 resume（保留 resume_from_checkpoint=true）
    const sqlB = findPhaseBSelect();
    expect(sqlB).not.toBe('');
    expect(bUpdSql).toMatch(/"resume_from_checkpoint":\s*true/);
  });

  it('phase A 查询排除 skill-relay 任务（relay 不写活性信号，误判会双 spawn，Issue df107724）', async () => {
    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
    await resumeStalledHarnessDrivers(OPTS);
    const sqlA = findPhaseASelect();
    expect(sqlA).not.toBe('');
    expect(sqlA).toMatch(/orchestrator'\s+IS\s+DISTINCT\s+FROM\s+'skill-relay'/i);
  });

  it('phase B 查询同样排除 skill-relay 任务（防 LangGraph 僵尸 B_task_loop 行 + relay 心跳恒 NULL 的组合误判）', async () => {
    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
    await resumeStalledHarnessDrivers(OPTS);
    const sqlB = findPhaseBSelect();
    expect(sqlB).not.toBe('');
    expect(sqlB).toMatch(/orchestrator'\s+IS\s+DISTINCT\s+FROM\s+'skill-relay'/i);
  });
});
