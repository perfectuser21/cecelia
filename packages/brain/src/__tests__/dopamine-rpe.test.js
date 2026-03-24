/**
 * dopamine-rpe.test.js — Dopamine RPE（奖赏预测误差）测试
 *
 * 验收标准：
 * 1. computeRPE 纯函数：actual - expected
 * 2. getExpectedIntensity 查历史同类任务均值
 * 3. recordExpectedReward 写入 expected_reward 事件
 * 4. recordReward 在有期望记录时自动写入 rpe_signal
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import { computeRPE, getExpectedIntensity, recordExpectedReward, recordReward } from '../dopamine.js';

// ── computeRPE 纯函数 ────────────────────────────────────

describe('computeRPE', () => {
  it('actual > expected 时返回正值（比预期好）', () => {
    expect(computeRPE(1.0, 0.5)).toBeCloseTo(0.5);
  });

  it('actual < expected 时返回负值（比预期差）', () => {
    expect(computeRPE(0.3, 0.7)).toBeCloseTo(-0.4);
  });

  it('actual === expected 时 RPE ≈ 0', () => {
    expect(computeRPE(0.5, 0.5)).toBeCloseTo(0);
  });

  it('expected 为 null 时返回 null（无基线）', () => {
    expect(computeRPE(1.0, null)).toBeNull();
  });
});

// ── getExpectedIntensity ─────────────────────────────────

describe('getExpectedIntensity', () => {
  it('返回同类任务历史平均奖赏强度', async () => {
    const mockRows = [
      { intensity: '1.0' },
      { intensity: '0.7' },
      { intensity: '0.5' },
    ];
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: mockRows }),
    };

    const result = await getExpectedIntensity('dev', 'dev-skill', mockPool);
    expect(result).toBeCloseTo((1.0 + 0.7 + 0.5) / 3);
  });

  it('无历史记录时返回 null', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };

    const result = await getExpectedIntensity('dev', 'dev-skill', mockPool);
    expect(result).toBeNull();
  });

  it('SQL 查询包含 taskType 和 skill 过滤', async () => {
    const querySpy = vi.fn().mockResolvedValue({ rows: [] });
    const mockPool = { query: querySpy };

    await getExpectedIntensity('content', 'writer', mockPool);

    const [sql, params] = querySpy.mock.calls[0];
    expect(sql).toContain('reward_signal');
    expect(params).toContain('content');
    expect(params).toContain('writer');
  });
});

// ── recordExpectedReward ─────────────────────────────────

describe('recordExpectedReward', () => {
  it('写入 expected_reward 事件到 cecelia_events', async () => {
    const insertSpy = vi.fn().mockResolvedValue({ rows: [{ id: 1 }] });
    const mockPool = {
      query: vi.fn().mockImplementation((sql, params) => {
        if (typeof sql === 'string' && sql.includes('INSERT')) {
          insertSpy(sql, params);
          return Promise.resolve({ rows: [{ id: 1 }] });
        }
        // getExpectedIntensity 查询 → 返回有历史数据
        return Promise.resolve({ rows: [{ intensity: '0.7' }] });
      }),
    };

    await recordExpectedReward('task-123', 'dev', 'dev-skill', mockPool);

    expect(insertSpy).toHaveBeenCalled();
    const [sql, params] = insertSpy.mock.calls[0];
    expect(sql).toContain('expected_reward');
    // payload 包含 task_id 和 expected_intensity
    const payload = typeof params[0] === 'string' ? JSON.parse(params[0]) : params[0];
    expect(payload.task_id).toBe('task-123');
    expect(typeof payload.expected_intensity).toBe('number');
  });

  it('无历史数据时跳过写入', async () => {
    const insertSpy = vi.fn();
    const mockPool = {
      query: vi.fn().mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('INSERT')) {
          insertSpy();
        }
        return Promise.resolve({ rows: [] }); // 无历史
      }),
    };

    await recordExpectedReward('task-456', 'new-type', 'new-skill', mockPool);

    expect(insertSpy).not.toHaveBeenCalled();
  });
});

// ── recordReward 自动写入 rpe_signal ─────────────────────

describe('recordReward RPE 自动写入', () => {
  it('有期望记录时 recordReward 写入 rpe_signal', async () => {
    const rpeSpy = vi.fn().mockResolvedValue({ rows: [] });

    const mockPool = {
      query: vi.fn().mockImplementation((sql, params) => {
        if (typeof sql === 'string') {
          if (sql.includes('INSERT') && sql.includes('reward_signal')) {
            return Promise.resolve({ rows: [{ id: 99 }] });
          }
          if (sql.includes('expected_reward')) {
            // 返回期望奖赏记录
            return Promise.resolve({ rows: [{ payload: { expected_intensity: 0.5 } }] });
          }
          if (sql.includes('rpe_signal')) {
            rpeSpy(sql, params);
            return Promise.resolve({ rows: [] });
          }
        }
        return Promise.resolve({ rows: [] });
      }),
    };

    await recordReward('task-789', 'task_completed', 1.0, { taskType: 'dev', skill: 'dev-skill' }, mockPool);

    // 应当有 rpe_signal 写入
    expect(rpeSpy).toHaveBeenCalled();
  });

  it('无期望记录时不写入 rpe_signal', async () => {
    const rpeSpy = vi.fn();

    const mockPool = {
      query: vi.fn().mockImplementation((sql, params) => {
        if (typeof sql === 'string') {
          if (sql.includes('INSERT') && sql.includes('reward_signal')) {
            return Promise.resolve({ rows: [{ id: 99 }] });
          }
          if (sql.includes('expected_reward')) {
            return Promise.resolve({ rows: [] }); // 无期望记录
          }
          if (sql.includes('rpe_signal')) {
            rpeSpy();
          }
        }
        return Promise.resolve({ rows: [] });
      }),
    };

    await recordReward('task-000', 'task_completed', 0.7, {}, mockPool);

    expect(rpeSpy).not.toHaveBeenCalled();
  });
});
