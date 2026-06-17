/**
 * harness-driver-heartbeat-watchdog.test.js
 *
 * OPEN-2 回归测试：harness_initiative parent graph 的驱动器（planner-callback 的
 * 一次性 in-memory invoke）在 graph 到 END 前丢失（brain 重启/部署/异常）后，
 * 任务 park 在非-END checkpoint。dispatcher 只 claim queued、唯一 re-driver
 * startup-sync 仅 boot 跑 → 任务死等下次重启。
 *
 * resumeStalledHarnessDrivers = tick 级看门狗：只重排「心跳陈旧(>10min，根因3 从
 * 3min 加固) 且停在 B_task_loop（run_sub_task 阻塞区）」的 in_progress
 * harness_initiative 任务。
 *
 * 关键安全不变量（本测试守护）：
 *   1. 只扫 phase='B_task_loop'（排除 A_planning planner-interrupt-wait → 不误杀
 *      正在等 planner callback 的合法任务）。
 *   2. 只重排心跳陈旧/NULL 的任务（活驱动每 30s 心跳 → 新鲜的不动，杜绝双驱动）。
 *   3. 重排 = status→queued + resume_from_checkpoint=true + 清 claim 三件套。
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

describe('resumeStalledHarnessDrivers — OPEN-2 看门狗', () => {
  it('export 存在并是函数', () => {
    expect(typeof resumeStalledHarnessDrivers).toBe('function');
  });

  it('SELECT 只扫 B_task_loop + in_progress + harness_initiative + 心跳陈旧/NULL，排除 A_planning', async () => {
    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
    await resumeStalledHarnessDrivers({});
    const sql = mockPoolQuery.mock.calls[0]?.[0] || '';
    expect(sql).toMatch(/B_task_loop/);
    // 关键：不能扫 A_planning（planner-interrupt-wait 合法状态，重排会 thrash）
    expect(sql).not.toMatch(/A_planning/);
    expect(sql).toMatch(/harness_initiative/);
    expect(sql).toMatch(/in_progress/);
    expect(sql).toMatch(/driver_heartbeat_at/);
    expect(sql).toMatch(/IS\s+NULL/i);
  });

  it('默认 staleMinutes=10（根因3：3min 太敏感，driver 长同步操作期间心跳断流被误判重排）', async () => {
    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
    await resumeStalledHarnessDrivers({});
    const params = mockPoolQuery.mock.calls[0]?.[1] || [];
    // SELECT 的第一个参数是 staleMinutes 字符串
    expect(params[0]).toBe('10');
  });

  it('无陈旧任务 → resumed 空', async () => {
    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
    const r = await resumeStalledHarnessDrivers({});
    expect(r.resumed).toEqual([]);
    expect(r.scanned).toBe(0);
  });

  it('陈旧 + B_task_loop 任务 → 重排为 queued + resume_from_checkpoint + 清 claim 三件套', async () => {
    const TASK_ID = 'aaaa1111-2222-3333-4444-555566667777';
    let updateSql = '';
    let updateParams = [];
    mockPoolQuery.mockImplementation(async (sql, params) => {
      // 仅 B 阶段查询命中（A 阶段活动判据查询返回空，避免双计数）
      if (/SELECT/i.test(sql) && /B_task_loop/.test(sql) && !/GREATEST/i.test(sql)) {
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
    expect(r.resumed).toEqual([TASK_ID]);
    // 重排 = queued
    expect(updateSql).toMatch(/status\s*=\s*'queued'/i);
    // resume_from_checkpoint 标志（让 executor 走 resume 而非 fresh start）
    expect(updateSql).toMatch(/resume_from_checkpoint/);
    // 清 claim 三件套（否则 dispatcher 的 claimed_by IS NULL 永远选不出 → 死锁）
    expect(updateSql).toMatch(/claimed_by\s*=\s*NULL/i);
    expect(updateSql).toMatch(/claimed_at\s*=\s*NULL/i);
    expect(updateSql).toMatch(/started_at\s*=\s*NULL/i);
    // 原子守卫：只在仍 in_progress 时翻转（防两个 tick 并发双翻）
    expect(updateSql).toMatch(/status\s*=\s*'in_progress'/i);
    expect(updateParams).toContain(TASK_ID);
  });

  it('UPDATE 原子守卫返回 0 行（已被别的 tick 抢翻）→ 不计入 resumed', async () => {
    const TASK_ID = 'bbbb1111-2222-3333-4444-555566667777';
    mockPoolQuery.mockImplementation(async (sql) => {
      // 仅 B 阶段查询命中（A 阶段活动判据查询返回空）
      if (/SELECT/i.test(sql) && /B_task_loop/.test(sql) && !/GREATEST/i.test(sql)) {
        return { rows: [{ id: TASK_ID }] };
      }
      if (/SELECT/i.test(sql)) return { rows: [] };
      if (/UPDATE\s+tasks/i.test(sql)) return { rows: [] }; // 抢翻失败
      return { rows: [] };
    });
    const r = await resumeStalledHarnessDrivers({});
    expect(r.resumed).toEqual([]);
    expect(r.scanned).toBe(1);
  });
});
