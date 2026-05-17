/**
 * C4 Pre-flight Cancel Alerting 单元测试
 *
 * 覆盖：
 *  1. 单次 fail（24h 无累积）→ raise 用 P2 + source=pre_flight_cancel
 *  2. 累计 fail_count >= 阈值 → 升级 raise 用 P0 + source=pre_flight_burst
 *  3. issues 为空数组 → 依然生成 basicMsg，不崩
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock alerting.raise — 必须在 import 目标模块之前
vi.mock('../alerting.js', () => ({
  raise: vi.fn().mockResolvedValue(undefined),
}));

import { raise } from '../alerting.js';
import { alertOnPreFlightFail, PRE_FLIGHT_ALERT_THRESHOLD } from '../pre-flight-check.js';

function makePool(count) {
  return {
    query: vi.fn().mockResolvedValue({ rows: [{ c: count }] }),
  };
}

describe('alertOnPreFlightFail (C4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1) 单次 fail (24h 内 count=1) → raise(P2, pre_flight_cancel, msg)', async () => {
    const pool = makePool(1);
    const task = { id: 'task-001', title: 'Feature X' };
    const checkResult = { issues: ['Description too short'] };

    await alertOnPreFlightFail(pool, task, checkResult);

    expect(raise).toHaveBeenCalledTimes(1);
    const [level, source, message] = raise.mock.calls[0];
    expect(level).toBe('P2');
    expect(source).toBe('pre_flight_cancel');
    expect(message).toContain('Feature X');
    expect(message).toContain('task-001');
    expect(message).toContain('Description too short');
  });

  it(`2) 累计 fail_count >= ${PRE_FLIGHT_ALERT_THRESHOLD} → 升级 raise(P0, pre_flight_burst, msg)`, async () => {
    const pool = makePool(PRE_FLIGHT_ALERT_THRESHOLD);
    const task = { id: 'task-burst-003', title: 'Bad PRD Task' };
    const checkResult = { issues: ['Task title too short', 'Invalid priority'] };

    await alertOnPreFlightFail(pool, task, checkResult);

    expect(raise).toHaveBeenCalledTimes(1);
    const [level, source, message] = raise.mock.calls[0];
    expect(level).toBe('P0');
    expect(source).toBe('pre_flight_burst');
    expect(message).toContain('URGENT');
    expect(message).toContain(String(PRE_FLIGHT_ALERT_THRESHOLD));
    expect(message).toContain('Bad PRD Task');
    expect(message).toContain('Task title too short');
  });

  it('2b) 远超阈值 (count=10) 仍走 P0 分支', async () => {
    const pool = makePool(10);
    const task = { id: 'task-huge', title: 'Big Burst' };
    const checkResult = { issues: ['Empty description'] };

    await alertOnPreFlightFail(pool, task, checkResult);

    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise.mock.calls[0][0]).toBe('P0');
    expect(raise.mock.calls[0][1]).toBe('pre_flight_burst');
    expect(raise.mock.calls[0][2]).toContain('24h 内 10');
  });

  it('3a) issues 为空数组 → 仍生成 basicMsg，不崩', async () => {
    const pool = makePool(1);
    const task = { id: 'task-empty-issues', title: 'No Issues Task' };
    const checkResult = { issues: [] };

    await alertOnPreFlightFail(pool, task, checkResult);

    expect(raise).toHaveBeenCalledTimes(1);
    const [, , message] = raise.mock.calls[0];
    expect(message).toContain('No Issues Task');
    expect(message).toContain('task-empty-issues');
  });

  it('3b) checkResult.issues 为 undefined → 不崩，走 fallback 文本', async () => {
    const pool = makePool(1);
    const task = { id: 'task-no-issues-key', title: 'Undefined Issues' };
    const checkResult = {}; // 没有 issues 字段

    await alertOnPreFlightFail(pool, task, checkResult);

    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise.mock.calls[0][0]).toBe('P2');
  });

  it('3c) task.title 缺失 → 使用 (untitled) 占位', async () => {
    const pool = makePool(1);
    const task = { id: 'task-no-title' }; // 没 title
    const checkResult = { issues: ['something'] };

    await alertOnPreFlightFail(pool, task, checkResult);

    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise.mock.calls[0][2]).toContain('(untitled)');
  });

  it('4) DB query 失败 → 吞异常，不影响 dispatch 主流程', async () => {
    const pool = {
      query: vi.fn().mockRejectedValue(new Error('db connection refused')),
    };
    const task = { id: 'task-db-fail', title: 'DB Will Fail' };
    const checkResult = { issues: ['any'] };

    // 不应抛
    await expect(alertOnPreFlightFail(pool, task, checkResult)).resolves.toBeUndefined();

    // 既然 query 失败，raise 也不会被调用
    expect(raise).not.toHaveBeenCalled();
  });

  it('5) SQL 查询包含 metadata->>pre_flight_failed = true 条件', async () => {
    const pool = makePool(1);
    const task = { id: 'task-sql-check', title: 'Verify SQL' };
    await alertOnPreFlightFail(pool, task, { issues: [] });

    expect(pool.query).toHaveBeenCalledTimes(1);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/metadata->>'pre_flight_failed'\s*=\s*'true'/);
    expect(sql).toMatch(/INTERVAL\s*'24 hours'/);
  });
});
