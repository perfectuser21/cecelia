/**
 * task-weight-rpe.test.js — RPE 闭环对任务权重的影响
 *
 * 验收标准：
 * 1. getTaskRPEAdjustment: 历史 avg_rpe > 0 → 正向 bonus; < 0 → 负向 penalty; 无数据 → 0
 * 2. calculateTaskWeightAsync: weight = sync_weight + rpe_bonus; 返回 rpe_bonus 字段
 * 3. 无数据时行为与同步版本完全一致（向后兼容）
 * 4. DB 异常时安全降级（rpe_bonus = 0）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import {
  calculateTaskWeightAsync,
  getTaskRPEAdjustment,
  calculateTaskWeight,
  RPE_WEIGHT_SCALE,
  RPE_WEIGHT_CAP,
} from '../task-weight.js';

// ── getTaskRPEAdjustment ──────────────────────────────────

describe('getTaskRPEAdjustment', () => {
  it('历史 avg_rpe > 0 时返回正向 bonus', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ avg_rpe: '0.5' }] }),
    };
    const bonus = await getTaskRPEAdjustment('dev', mockPool);
    expect(bonus).toBeCloseTo(0.5 * RPE_WEIGHT_SCALE);
    expect(bonus).toBeGreaterThan(0);
  });

  it('历史 avg_rpe < 0 时返回负向 penalty', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ avg_rpe: '-0.5' }] }),
    };
    const bonus = await getTaskRPEAdjustment('dev', mockPool);
    expect(bonus).toBeCloseTo(-0.5 * RPE_WEIGHT_SCALE);
    expect(bonus).toBeLessThan(0);
  });

  it('无 rpe_signal 历史数据时返回 0', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ avg_rpe: null }] }),
    };
    const bonus = await getTaskRPEAdjustment('dev', mockPool);
    expect(bonus).toBe(0);
  });

  it('空行结果时返回 0', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    const bonus = await getTaskRPEAdjustment('dev', mockPool);
    expect(bonus).toBe(0);
  });

  it('taskType 为 null 时直接返回 0（不查 DB）', async () => {
    const mockPool = { query: vi.fn() };
    const bonus = await getTaskRPEAdjustment(null, mockPool);
    expect(bonus).toBe(0);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('DB 抛出异常时安全降级返回 0', async () => {
    const mockPool = {
      query: vi.fn().mockRejectedValue(new Error('DB connection failed')),
    };
    const bonus = await getTaskRPEAdjustment('dev', mockPool);
    expect(bonus).toBe(0);
  });

  it('正向 bonus 上限为 RPE_WEIGHT_CAP', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ avg_rpe: '100' }] }),
    };
    const bonus = await getTaskRPEAdjustment('dev', mockPool);
    expect(bonus).toBe(RPE_WEIGHT_CAP);
  });

  it('负向 penalty 下限为 -RPE_WEIGHT_CAP', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ avg_rpe: '-100' }] }),
    };
    const bonus = await getTaskRPEAdjustment('dev', mockPool);
    expect(bonus).toBe(-RPE_WEIGHT_CAP);
  });

  it('SQL 查询包含 rpe_signal 和 task_type 过滤', async () => {
    const querySpy = vi.fn().mockResolvedValue({ rows: [{ avg_rpe: null }] });
    const mockPool = { query: querySpy };

    await getTaskRPEAdjustment('review', mockPool);

    const [sql, params] = querySpy.mock.calls[0];
    expect(sql).toContain('rpe_signal');
    expect(params).toContain('review');
  });
});

// ── calculateTaskWeightAsync ──────────────────────────────

describe('calculateTaskWeightAsync', () => {
  it('RPE 偏高时总权重大于同步权重', async () => {
    const task = { priority: 'P1', queued_at: null, task_type: 'dev' };
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ avg_rpe: '0.5' }] }),
    };

    const syncResult = calculateTaskWeight(task);
    const asyncResult = await calculateTaskWeightAsync(task, mockPool);

    expect(asyncResult.rpe_bonus).toBeGreaterThan(0);
    expect(asyncResult.weight).toBeGreaterThan(syncResult.weight);
  });

  it('RPE 偏低时总权重小于同步权重', async () => {
    const task = { priority: 'P1', queued_at: null, task_type: 'dev' };
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ avg_rpe: '-0.5' }] }),
    };

    const syncResult = calculateTaskWeight(task);
    const asyncResult = await calculateTaskWeightAsync(task, mockPool);

    expect(asyncResult.rpe_bonus).toBeLessThan(0);
    expect(asyncResult.weight).toBeLessThan(syncResult.weight);
  });

  it('无 RPE 历史时权重与同步版本完全一致', async () => {
    const task = { priority: 'P0', queued_at: null, task_type: 'dev' };
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ avg_rpe: null }] }),
    };

    const syncResult = calculateTaskWeight(task);
    const asyncResult = await calculateTaskWeightAsync(task, mockPool);

    expect(asyncResult.rpe_bonus).toBe(0);
    expect(asyncResult.weight).toBe(syncResult.weight);
  });

  it('返回结果包含 rpe_bonus 字段', async () => {
    const task = { priority: 'P1', queued_at: null, task_type: 'review' };
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ avg_rpe: '0.3' }] }),
    };

    const result = await calculateTaskWeightAsync(task, mockPool);

    expect(result).toHaveProperty('rpe_bonus');
    expect(result).toHaveProperty('weight');
    expect(result).toHaveProperty('priority_score');
    expect(result).toHaveProperty('breakdown');
  });

  it('breakdown 字符串包含 rpe 分量', async () => {
    const task = { priority: 'P1', queued_at: null, task_type: 'dev' };
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ avg_rpe: '0.5' }] }),
    };

    const result = await calculateTaskWeightAsync(task, mockPool);

    expect(result.breakdown).toContain('rpe(');
  });

  it('null task 返回 weight=0 且 rpe_bonus=0', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    const result = await calculateTaskWeightAsync(null, mockPool);
    expect(result.weight).toBe(0);
    expect(result.rpe_bonus).toBe(0);
  });
});
