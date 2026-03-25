/**
 * task-weight-rpe.test.js — RPE 闭环：task-weight 使用 RPE 信号
 *
 * 验收标准：
 * 1. calculateTaskWeightAsync：有 RPE 数据时权重受影响
 * 2. RPE > 0（超预期）→ 权重提升
 * 3. RPE < 0（低于预期）→ 权重降低
 * 4. RPE 无数据时安全降级（rpe_bonus = 0，与同步版本一致）
 * 5. getAvgRPEForTaskType：正确查询均值
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calculateTaskWeight,
  calculateTaskWeightAsync,
  getAvgRPEForTaskType,
  RPE_BONUS_MAX,
  RPE_BONUS_MIN,
  RPE_SCALE_FACTOR
} from '../task-weight.js';

// Fixed "now" for deterministic tests
const FIXED_NOW = new Date('2026-03-02T10:00:00.000Z');

describe('calculateTaskWeight — rpe_bonus 字段', () => {
  it('同步版本 rpe_bonus 应始终为 0', () => {
    const task = { priority: 'P1', queued_at: null, task_type: 'dev' };
    const result = calculateTaskWeight(task);
    expect(result.rpe_bonus).toBe(0);
  });

  it('breakdown 应包含 rpe(0)', () => {
    const task = { priority: 'P0', queued_at: null, task_type: null };
    const result = calculateTaskWeight(task);
    expect(result.breakdown).toContain('rpe(0)');
  });
});

describe('getAvgRPEForTaskType', () => {
  it('返回最近同类任务的平均 RPE', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({
        rows: [{ avg_rpe: '0.3' }]
      })
    };
    const result = await getAvgRPEForTaskType('dev', mockDb);
    expect(result).toBeCloseTo(0.3);
  });

  it('无数据时返回 null', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [{ avg_rpe: null }] })
    };
    const result = await getAvgRPEForTaskType('dev', mockDb);
    expect(result).toBeNull();
  });

  it('无 taskType 时返回 null', async () => {
    const result = await getAvgRPEForTaskType(null, {});
    expect(result).toBeNull();
  });

  it('无 db 时返回 null', async () => {
    const result = await getAvgRPEForTaskType('dev', null);
    expect(result).toBeNull();
  });

  it('DB 查询包含 rpe_signal 和 task_type 过滤', async () => {
    const querySpy = vi.fn().mockResolvedValue({ rows: [{ avg_rpe: '0' }] });
    const mockDb = { query: querySpy };

    await getAvgRPEForTaskType('review', mockDb);

    const [sql, params] = querySpy.mock.calls[0];
    expect(sql).toContain('rpe_signal');
    expect(sql).toContain("payload->>'task_type'");
    expect(params).toContain('review');
  });

  it('DB 查询异常时安全返回 null', async () => {
    const mockDb = {
      query: vi.fn().mockRejectedValue(new Error('DB error'))
    };
    const result = await getAvgRPEForTaskType('dev', mockDb);
    expect(result).toBeNull();
  });
});

describe('calculateTaskWeightAsync — RPE 高 → 权重提升', () => {
  beforeEach(() => {
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('RPE > 0 时 rpe_bonus > 0，权重高于同步版本', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [{ avg_rpe: '0.5' }] })
    };
    const task = { priority: 'P1', queued_at: null, task_type: 'dev' };

    const syncResult = calculateTaskWeight(task);
    const asyncResult = await calculateTaskWeightAsync(task, mockDb);

    expect(asyncResult.rpe_bonus).toBeGreaterThan(0);
    expect(asyncResult.weight).toBeGreaterThan(syncResult.weight);
  });

  it('RPE < 0 时 rpe_bonus < 0，权重低于同步版本', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [{ avg_rpe: '-0.4' }] })
    };
    const task = { priority: 'P1', queued_at: null, task_type: 'dev' };

    const syncResult = calculateTaskWeight(task);
    const asyncResult = await calculateTaskWeightAsync(task, mockDb);

    expect(asyncResult.rpe_bonus).toBeLessThan(0);
    expect(asyncResult.weight).toBeLessThan(syncResult.weight);
  });

  it('RPE 无数据时安全降级，rpe_bonus = 0，权重与同步版本相同', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [{ avg_rpe: null }] })
    };
    const task = { priority: 'P1', queued_at: null, task_type: 'dev' };

    const syncResult = calculateTaskWeight(task);
    const asyncResult = await calculateTaskWeightAsync(task, mockDb);

    expect(asyncResult.rpe_bonus).toBe(0);
    expect(asyncResult.weight).toBe(syncResult.weight);
  });

  it('不提供 db 时安全降级，结果与同步版本一致', async () => {
    const task = { priority: 'P1', queued_at: null, task_type: 'dev' };

    const syncResult = calculateTaskWeight(task);
    const asyncResult = await calculateTaskWeightAsync(task, null);

    expect(asyncResult.rpe_bonus).toBe(0);
    expect(asyncResult.weight).toBe(syncResult.weight);
  });

  it('task_type 为 null 时安全降级', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [{ avg_rpe: '0.5' }] })
    };
    const task = { priority: 'P1', queued_at: null, task_type: null };

    const syncResult = calculateTaskWeight(task);
    const asyncResult = await calculateTaskWeightAsync(task, mockDb);

    // 无 task_type，不查 RPE，安全降级
    expect(asyncResult.rpe_bonus).toBe(0);
    expect(asyncResult.weight).toBe(syncResult.weight);
  });

  it('rpe_bonus 不超过 RPE_BONUS_MAX（+10）', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [{ avg_rpe: '5.0' }] }) // 极大 RPE
    };
    const task = { priority: 'P1', queued_at: null, task_type: 'dev' };

    const asyncResult = await calculateTaskWeightAsync(task, mockDb);
    expect(asyncResult.rpe_bonus).toBeLessThanOrEqual(RPE_BONUS_MAX);
  });

  it('rpe_bonus 不低于 RPE_BONUS_MIN（-10）', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [{ avg_rpe: '-5.0' }] }) // 极小 RPE
    };
    const task = { priority: 'P1', queued_at: null, task_type: 'dev' };

    const asyncResult = await calculateTaskWeightAsync(task, mockDb);
    expect(asyncResult.rpe_bonus).toBeGreaterThanOrEqual(RPE_BONUS_MIN);
  });

  it('RPE = 0.5，scale_factor = 10 → rpe_bonus = 5', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [{ avg_rpe: '0.5' }] })
    };
    const task = { priority: 'P1', queued_at: null, task_type: 'dev' };

    const asyncResult = await calculateTaskWeightAsync(task, mockDb);
    // 0.5 * 10 = 5，未超上限
    expect(asyncResult.rpe_bonus).toBe(5);
  });

  it('breakdown 应包含 rpe_bonus 的实际值', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [{ avg_rpe: '0.3' }] })
    };
    const task = { priority: 'P1', queued_at: null, task_type: 'dev' };

    const asyncResult = await calculateTaskWeightAsync(task, mockDb);
    expect(asyncResult.breakdown).toContain(`rpe(${asyncResult.rpe_bonus})`);
  });

  it('DB 异常时安全降级，rpe_bonus = 0', async () => {
    const mockDb = {
      query: vi.fn().mockRejectedValue(new Error('connection timeout'))
    };
    const task = { priority: 'P1', queued_at: null, task_type: 'dev' };

    const syncResult = calculateTaskWeight(task);
    const asyncResult = await calculateTaskWeightAsync(task, mockDb);

    expect(asyncResult.rpe_bonus).toBe(0);
    expect(asyncResult.weight).toBe(syncResult.weight);
  });
});

describe('calculateTaskWeightAsync — 不破坏现有排序逻辑', () => {
  beforeEach(() => {
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('P0 任务即使有负 RPE，权重仍高于 P1 正 RPE 任务', async () => {
    const negRpeDb = {
      query: vi.fn().mockResolvedValue({ rows: [{ avg_rpe: '-1.0' }] })
    };
    const posRpeDb = {
      query: vi.fn().mockResolvedValue({ rows: [{ avg_rpe: '1.0' }] })
    };

    const p0Task = { priority: 'P0', queued_at: null, task_type: 'dev' };
    const p1Task = { priority: 'P1', queued_at: null, task_type: 'dev' };

    const p0Result = await calculateTaskWeightAsync(p0Task, negRpeDb);
    const p1Result = await calculateTaskWeightAsync(p1Task, posRpeDb);

    // P0（100 - 10 = 90）应仍高于 P1（60 + 10 = 70）
    expect(p0Result.weight).toBeGreaterThan(p1Result.weight);
  });
});
