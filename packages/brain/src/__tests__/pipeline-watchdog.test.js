/**
 * Pipeline Watchdog Tests
 *
 * 验证：
 * 1. pipeline 超过 6h 无任务状态更新 → 标记 stuck + 取消 open 任务 + 写事件
 * 2. pipeline 刚更新过 → watchdog 不动
 * 3. pipeline 已有 completed harness_report → watchdog 忽略（正常收尾）
 * 4. pipeline 没有 open 任务 → watchdog 忽略（已静止）
 * 5. 阈值可配置（opts.thresholdHours）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkStuckPipelines } from '../pipeline-watchdog.js';

function makePool() {
  return {
    query: vi.fn(),
  };
}

function hoursAgo(h) {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

describe('pipeline-watchdog', () => {
  let pool;

  beforeEach(() => {
    pool = makePool();
  });

  it('6 小时前无更新 + 存在 open 任务 → 标记 stuck', async () => {
    // 1st call: aggregate query
    pool.query.mockImplementationOnce(async () => ({
      rows: [
        {
          sprint_dir: 'harness-v5-e2e-test2',
          last_update: hoursAgo(8),
          open_count: '3',
          completed_reports: '0',
          total: '10',
        },
      ],
    }));
    // 2nd call: planner lookup
    pool.query.mockImplementationOnce(async () => ({
      rows: [{ id: 'planner-abc', payload: { planner_task_id: 'd8acf398' } }],
    }));
    // 3rd call: UPDATE tasks ... RETURNING id
    pool.query.mockImplementationOnce(async () => ({
      rows: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
    }));
    // 4th call: INSERT INTO cecelia_events
    pool.query.mockImplementationOnce(async () => ({ rows: [] }));

    const r = await checkStuckPipelines(pool);

    expect(r.scanned).toBe(1);
    expect(r.stuck).toBe(1);
    expect(r.pipelines[0].sprint_dir).toBe('harness-v5-e2e-test2');
    expect(r.pipelines[0].planner_task_id).toBe('d8acf398');
    expect(r.pipelines[0].canceled_task_ids).toEqual(['t1', 't2', 't3']);
    expect(r.pipelines[0].stuck_for_hours).toBeGreaterThanOrEqual(6);

    // UPDATE & INSERT 都被调用
    const calls = pool.query.mock.calls;
    expect(calls[2][0]).toMatch(/UPDATE tasks/);
    expect(calls[2][0]).toMatch(/status = 'canceled'/);
    expect(calls[2][0]).toMatch(/error_message = 'pipeline_stuck'/);
    expect(calls[3][0]).toMatch(/INSERT INTO cecelia_events/);
    expect(calls[3][1][0]).toBe('pipeline_stuck');
    expect(calls[3][1][1]).toBe('pipeline-watchdog');
    const eventPayload = JSON.parse(calls[3][1][2]);
    expect(eventPayload.sprint_dir).toBe('harness-v5-e2e-test2');
    expect(eventPayload.planner_task_id).toBe('d8acf398');
    expect(eventPayload.canceled_task_ids).toEqual(['t1', 't2', 't3']);
  });

  it('刚刚更新过 → watchdog 不动', async () => {
    pool.query.mockImplementationOnce(async () => ({
      rows: [
        {
          sprint_dir: 'harness-fresh',
          last_update: hoursAgo(0.1), // 6 分钟前
          open_count: '3',
          completed_reports: '0',
          total: '5',
        },
      ],
    }));

    const r = await checkStuckPipelines(pool);

    expect(r.scanned).toBe(1);
    expect(r.stuck).toBe(0);
    expect(r.pipelines).toEqual([]);
    // 只调了 aggregate query，UPDATE/INSERT 不应被调用
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('已有 completed harness_report → 忽略', async () => {
    pool.query.mockImplementationOnce(async () => ({
      rows: [
        {
          sprint_dir: 'harness-done',
          last_update: hoursAgo(24), // 一天前
          open_count: '0',
          completed_reports: '1',
          total: '10',
        },
      ],
    }));

    const r = await checkStuckPipelines(pool);

    expect(r.scanned).toBe(1);
    expect(r.stuck).toBe(0);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('没有 open 任务 → 忽略', async () => {
    pool.query.mockImplementationOnce(async () => ({
      rows: [
        {
          sprint_dir: 'harness-failed',
          last_update: hoursAgo(48),
          open_count: '0',
          completed_reports: '0',
          total: '5',
        },
      ],
    }));

    const r = await checkStuckPipelines(pool);

    expect(r.scanned).toBe(1);
    expect(r.stuck).toBe(0);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('阈值可通过 opts.thresholdHours 配置', async () => {
    pool.query.mockImplementationOnce(async () => ({
      rows: [
        {
          sprint_dir: 'harness-edge',
          last_update: hoursAgo(2), // 2h 前
          open_count: '1',
          completed_reports: '0',
          total: '3',
        },
      ],
    }));
    // 阈值 1h → 2h 前应被判定为 stuck
    pool.query.mockImplementationOnce(async () => ({
      rows: [{ id: 'planner-x', payload: {} }],
    }));
    pool.query.mockImplementationOnce(async () => ({
      rows: [{ id: 'tX' }],
    }));
    pool.query.mockImplementationOnce(async () => ({ rows: [] }));

    const r = await checkStuckPipelines(pool, { thresholdHours: 1 });

    expect(r.stuck).toBe(1);
    expect(r.pipelines[0].sprint_dir).toBe('harness-edge');
  });

  it('planner_task_id 缺失时回退到最早任务的 id', async () => {
    pool.query.mockImplementationOnce(async () => ({
      rows: [
        {
          sprint_dir: 'harness-nopayload',
          last_update: hoursAgo(10),
          open_count: '1',
          completed_reports: '0',
          total: '2',
        },
      ],
    }));
    // payload 无 planner_task_id → fallback 到 task.id
    pool.query.mockImplementationOnce(async () => ({
      rows: [{ id: 'earliest-task-id', payload: {} }],
    }));
    pool.query.mockImplementationOnce(async () => ({ rows: [{ id: 'tY' }] }));
    pool.query.mockImplementationOnce(async () => ({ rows: [] }));

    const r = await checkStuckPipelines(pool);

    expect(r.stuck).toBe(1);
    expect(r.pipelines[0].planner_task_id).toBe('earliest-task-id');
  });

  it('聚合查询只关注 harness_* task_type', async () => {
    pool.query.mockImplementationOnce(async () => ({ rows: [] }));

    await checkStuckPipelines(pool);

    const firstCall = pool.query.mock.calls[0];
    const taskTypes = firstCall[1][0];
    expect(taskTypes).toContain('harness_planner');
    expect(taskTypes).toContain('harness_generate');
    expect(taskTypes).toContain('harness_report');
    expect(taskTypes).not.toContain('dev');
    expect(taskTypes).not.toContain('content_publish');
  });
});
