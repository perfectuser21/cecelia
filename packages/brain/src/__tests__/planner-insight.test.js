/**
 * Planner 反刍闭环测试 — planner-insight.test.js
 *
 * 测试 buildInsightAdjustments 和 scoreKRs 对洞察信号的处理。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildInsightAdjustments, scoreKRs, applyContentAwareScore } from '../planner.js';

// ──────────────────────────────────────────────────────────────
// Mock 依赖
// ──────────────────────────────────────────────────────────────

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

vi.mock('../focus.js', () => ({
  getDailyFocus: vi.fn().mockResolvedValue(null),
}));

import pool from '../db.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────
// buildInsightAdjustments 测试
// ──────────────────────────────────────────────────────────────

describe('buildInsightAdjustments', () => {
  it('空 krIds 返回空 Map', async () => {
    const result = await buildInsightAdjustments([]);
    expect(result.size).toBe(0);
  });

  it('null krIds 返回空 Map', async () => {
    const result = await buildInsightAdjustments(null);
    expect(result.size).toBe(0);
  });

  it('success_pattern → 正调整（+5 每条，最多 +15）', async () => {
    const krId = 'kr-001';
    pool.query.mockResolvedValueOnce({
      rows: [{ kr_id: krId, category: 'success_pattern', cnt: '3' }]
    });

    const result = await buildInsightAdjustments([krId]);
    expect(result.get(krId)).toBe(15); // 5 × min(3,3)
  });

  it('cortex_insight → 负调整（-8）', async () => {
    const krId = 'kr-002';
    pool.query.mockResolvedValueOnce({
      rows: [{ kr_id: krId, category: 'cortex_insight', cnt: '1' }]
    });

    const result = await buildInsightAdjustments([krId]);
    expect(result.get(krId)).toBe(-8);
  });

  it('failure_pattern → 负调整（-10 每条，最多 -20）', async () => {
    const krId = 'kr-003';
    pool.query.mockResolvedValueOnce({
      rows: [{ kr_id: krId, category: 'failure_pattern', cnt: '5' }]
    });

    const result = await buildInsightAdjustments([krId]);
    expect(result.get(krId)).toBe(-20); // -10 × min(5,2)
  });

  it('多条洞察叠加同一 KR', async () => {
    const krId = 'kr-004';
    pool.query.mockResolvedValueOnce({
      rows: [
        { kr_id: krId, category: 'success_pattern', cnt: '1' },
        { kr_id: krId, category: 'cortex_insight', cnt: '1' }
      ]
    });

    const result = await buildInsightAdjustments([krId]);
    // success +5 + cortex -8 = -3
    expect(result.get(krId)).toBe(-3);
  });

  it('DB 查询失败时优雅降级，返回空 Map', async () => {
    pool.query.mockRejectedValueOnce(new Error('DB error'));

    const result = await buildInsightAdjustments(['kr-999']);
    expect(result.size).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────
// scoreKRs 洞察注入测试
// ──────────────────────────────────────────────────────────────

describe('scoreKRs insightAdjustments', () => {
  const makeState = (krs) => ({
    keyResults: krs,
    activeTasks: [],
    focus: null
  });

  it('有正向洞察的 KR 得分高于无洞察的 KR', () => {
    const krA = { id: 'kr-a', priority: 'P1', progress: 50 };
    const krB = { id: 'kr-b', priority: 'P1', progress: 50 };
    const state = makeState([krA, krB]);
    const adjustments = new Map([['kr-a', 15]]); // success bonus for A

    const scored = scoreKRs(state, adjustments);
    const scoreA = scored.find(s => s.kr.id === 'kr-a')?.score;
    const scoreB = scored.find(s => s.kr.id === 'kr-b')?.score;

    expect(scoreA).toBeGreaterThan(scoreB);
  });

  it('有负向洞察的 KR 得分低于无洞察的 KR', () => {
    const krA = { id: 'kr-a', priority: 'P1', progress: 50 };
    const krB = { id: 'kr-b', priority: 'P1', progress: 50 };
    const state = makeState([krA, krB]);
    const adjustments = new Map([['kr-a', -20]]); // failure penalty for A

    const scored = scoreKRs(state, adjustments);
    const scoreA = scored.find(s => s.kr.id === 'kr-a')?.score;
    const scoreB = scored.find(s => s.kr.id === 'kr-b')?.score;

    expect(scoreA).toBeLessThan(scoreB);
  });

  it('无 insightAdjustments 时行为与原来一致（向后兼容）', () => {
    const krs = [
      { id: 'kr-a', priority: 'P0', progress: 30 },
      { id: 'kr-b', priority: 'P1', progress: 70 }
    ];
    const state = makeState(krs);

    const scored = scoreKRs(state); // 不传 insightAdjustments
    expect(scored.length).toBe(2);
    expect(scored[0].kr.id).toBe('kr-a'); // P0 应该排第一
  });
});
