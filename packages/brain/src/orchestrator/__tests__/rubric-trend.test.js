/**
 * rubric-trend.test.js —— detectRubricTrend 纯函数全场景单测。
 * 语义 SSOT：docs/superpowers/specs/2026-08-04-gan-case-file-design.md §数据流 4。
 */
import { describe, it, expect } from 'vitest';
import { detectRubricTrend } from '../rubric-trend.js';

function reviewerRow(round, rubric_scores, overrides = {}) {
  return { round, author_role: 'reviewer', rubric_scores, ...overrides };
}

function proposerRow(round, overrides = {}) {
  return { round, author_role: 'proposer', rubric_scores: null, blockers: [], ...overrides };
}

describe('detectRubricTrend [BEHAVIOR]', () => {
  it('非数组输入 → insufficient_data（不崩）', () => {
    expect(detectRubricTrend(null)).toBe('insufficient_data');
    expect(detectRubricTrend(undefined)).toBe('insufficient_data');
    expect(detectRubricTrend('not-an-array')).toBe('insufficient_data');
  });

  it('空数组 → insufficient_data', () => {
    expect(detectRubricTrend([])).toBe('insufficient_data');
  });

  it('reviewer 有效行 < 3 → insufficient_data', () => {
    const rows = [
      reviewerRow(1, { dod_machineability: 5, scope_match_prd: 5 }),
      reviewerRow(2, { dod_machineability: 6, scope_match_prd: 6 }),
    ];
    expect(detectRubricTrend(rows)).toBe('insufficient_data');
  });

  it('proposer 行不计入 reviewer 轮次计数（即使数量凑够 3 也不算）', () => {
    const rows = [
      reviewerRow(1, { dod: 5 }),
      proposerRow(1),
      proposerRow(2),
      proposerRow(3),
    ];
    expect(detectRubricTrend(rows)).toBe('insufficient_data');
  });

  it('rubric_scores 为 null 的 reviewer 行不计入（例如 REVISION 无结构化分数的历史行）', () => {
    const rows = [
      reviewerRow(1, { dod: 5 }),
      reviewerRow(2, null),
      reviewerRow(3, { dod: 6 }),
      reviewerRow(4, { dod: 7 }),
    ];
    // 只有 round 1/3/4 三条有效 → 恰好凑够 3 轮，全升 → converging
    expect(detectRubricTrend(rows)).toBe('converging');
  });

  it('任一维度连续 2 轮严格下降（a>b>c）→ diverging', () => {
    const rows = [
      reviewerRow(1, { dod_machineability: 8, scope_match_prd: 7 }),
      reviewerRow(2, { dod_machineability: 7, scope_match_prd: 7 }),
      reviewerRow(3, { dod_machineability: 6, scope_match_prd: 7 }),
    ];
    expect(detectRubricTrend(rows)).toBe('diverging');
  });

  it('任一维度高低高震荡（a>b 且 c>b）→ oscillating', () => {
    const rows = [
      reviewerRow(1, { dod_machineability: 8, scope_match_prd: 7 }),
      reviewerRow(2, { dod_machineability: 6, scope_match_prd: 7 }),
      reviewerRow(3, { dod_machineability: 8, scope_match_prd: 7 }),
    ];
    expect(detectRubricTrend(rows)).toBe('oscillating');
  });

  it('任一维度低高低震荡（a<b 且 c<b）→ oscillating', () => {
    const rows = [
      reviewerRow(1, { dod_machineability: 6, scope_match_prd: 7 }),
      reviewerRow(2, { dod_machineability: 8, scope_match_prd: 7 }),
      reviewerRow(3, { dod_machineability: 6, scope_match_prd: 7 }),
    ];
    expect(detectRubricTrend(rows)).toBe('oscillating');
  });

  it('全部维度持平 → converging（持平不是发散）', () => {
    const rows = [
      reviewerRow(1, { dod_machineability: 7, scope_match_prd: 7 }),
      reviewerRow(2, { dod_machineability: 7, scope_match_prd: 7 }),
      reviewerRow(3, { dod_machineability: 7, scope_match_prd: 7 }),
    ];
    expect(detectRubricTrend(rows)).toBe('converging');
  });

  it('全部维度上升 → converging', () => {
    const rows = [
      reviewerRow(1, { dod_machineability: 4, scope_match_prd: 4 }),
      reviewerRow(2, { dod_machineability: 5, scope_match_prd: 6 }),
      reviewerRow(3, { dod_machineability: 6, scope_match_prd: 8 }),
    ];
    expect(detectRubricTrend(rows)).toBe('converging');
  });

  it('oscillating 优先于 diverging：不同维度分别命中时判 oscillating', () => {
    const rows = [
      // dod: 8>7>6 连续下降（diverging 候选）；scope: 7,4,7 高低高（oscillating 候选）
      reviewerRow(1, { dod_machineability: 8, scope_match_prd: 7 }),
      reviewerRow(2, { dod_machineability: 7, scope_match_prd: 4 }),
      reviewerRow(3, { dod_machineability: 6, scope_match_prd: 7 }),
    ];
    expect(detectRubricTrend(rows)).toBe('oscillating');
  });

  it('缺维度容错：某轮缺失其他轮存在的维度不崩，跳过该维度按其余维度判定', () => {
    const rows = [
      reviewerRow(1, { dod_machineability: 8, risk_registered: 7 }),
      reviewerRow(2, { dod_machineability: 7 }), // 缺 risk_registered
      reviewerRow(3, { dod_machineability: 6, risk_registered: 7 }),
    ];
    // dod 8>7>6 连续下降 → diverging；risk 因 round2 缺失被跳过，不影响结果
    expect(detectRubricTrend(rows)).toBe('diverging');
  });

  it('非数值容错：维度值是字符串/非法值时跳过该维度不抛错', () => {
    const rows = [
      reviewerRow(1, { dod_machineability: 'N/A', scope_match_prd: 7 }),
      reviewerRow(2, { dod_machineability: 'N/A', scope_match_prd: 7 }),
      reviewerRow(3, { dod_machineability: 'N/A', scope_match_prd: 7 }),
    ];
    expect(() => detectRubricTrend(rows)).not.toThrow();
    expect(detectRubricTrend(rows)).toBe('converging');
  });

  it('取最近 3 轮，忽略更早轮次（第 4 轮回升不能掩盖最近 3 轮的发散）', () => {
    const rows = [
      reviewerRow(1, { dod_machineability: 3 }),
      reviewerRow(2, { dod_machineability: 9 }), // 更早的高分，不参与最近 3 轮判定
      reviewerRow(3, { dod_machineability: 8 }),
      reviewerRow(4, { dod_machineability: 7 }),
      reviewerRow(5, { dod_machineability: 6 }),
    ];
    // 最近 3 轮 = round 3/4/5：8>7>6 连续下降 → diverging
    expect(detectRubricTrend(rows)).toBe('diverging');
  });

  it('round 非整数的行不计入（防御脏数据）', () => {
    const rows = [
      reviewerRow(1, { dod: 5 }),
      reviewerRow(2, { dod: 6 }),
      { round: 2.5, author_role: 'reviewer', rubric_scores: { dod: 7 } },
    ];
    expect(detectRubricTrend(rows)).toBe('insufficient_data');
  });
});
