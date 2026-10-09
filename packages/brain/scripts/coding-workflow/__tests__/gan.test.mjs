// lib/gan.mjs：合同对抗的代码判分与收敛走势（移植 harness-gan.graph.js detectConvergenceTrend，不设轮数上限）。
import { describe, it, expect } from 'vitest';
import { RUBRIC_DIMS, THRESHOLD, detectTrend, decide } from '../lib/gan.mjs';

const s = (v) => Object.fromEntries(RUBRIC_DIMS.map((d, i) => [d, Array.isArray(v) ? v[i] : v]));
const round = (scores, specLines) => ({ scores, specLines });

describe('RUBRIC_DIMS / THRESHOLD', () => {
  it('5 个 QA 维度，阈值 7', () => {
    expect(RUBRIC_DIMS).toEqual(['意图对齐', '可验证', '场景覆盖', '回归风险', '可执行']);
    expect(THRESHOLD).toBe(7);
  });
});

describe('detectTrend', () => {
  it('不足 3 轮 → insufficient_data（继续对抗）', () => {
    expect(detectTrend([])).toBe('insufficient_data');
    expect(detectTrend([round(s(5)), round(s(6))])).toBe('insufficient_data');
    expect(detectTrend(null)).toBe('insufficient_data');
  });

  it('全部维度持平或上升 → converging', () => {
    expect(detectTrend([round(s(4)), round(s(5)), round(s(6))])).toBe('converging');
    expect(detectTrend([round(s(6)), round(s(6)), round(s(6))])).toBe('converging');
  });

  it('任一维度高低高 / 低高低 → oscillating（优先于 diverging）', () => {
    expect(detectTrend([round(s([8, 6, 6, 6, 6])), round(s([5, 6, 6, 6, 6])), round(s([8, 6, 6, 6, 6]))])).toBe('oscillating');
    expect(detectTrend([round(s([5, 6, 6, 6, 6])), round(s([8, 6, 6, 6, 6])), round(s([5, 6, 6, 6, 6]))])).toBe('oscillating');
  });

  it('任一维度连续两轮严格走低 → diverging', () => {
    expect(detectTrend([round(s([8, 6, 6, 6, 6])), round(s([7, 6, 6, 6, 6])), round(s([6, 6, 6, 6, 6]))])).toBe('diverging');
  });

  it('规格行数连续两轮净增长（越写越大）→ diverging；缺行数则不判', () => {
    expect(detectTrend([round(s(6), 100), round(s(6), 140), round(s(6), 200)])).toBe('diverging');
    expect(detectTrend([round(s(6), 100), round(s(6)), round(s(6), 200)])).toBe('converging');
  });

  it('只看最近 3 轮', () => {
    const early = [round(s([9, 6, 6, 6, 6])), round(s([3, 6, 6, 6, 6]))];
    expect(detectTrend([...early, round(s(6)), round(s(7)), round(s(8))])).toBe('converging');
  });
});

describe('decide', () => {
  const pass = s(7);
  it('5 维全部 ≥7 且没有未关闭的阻断/重要问题 → APPROVED', () => {
    expect(decide({ scores: pass, openIssues: [] })).toEqual({ approved: true, reasons: [] });
  });

  it('任一维度 <7 → 不通过，原因点名维度', () => {
    const r = decide({ scores: { ...pass, 场景覆盖: 6 }, openIssues: [] });
    expect(r.approved).toBe(false);
    expect(r.reasons).toContain('score_low:场景覆盖=6');
  });

  it('有未关闭的阻断/重要问题 → 不通过（评分再高也不行）', () => {
    const r = decide({ scores: s(10), openIssues: [{ id: 'R-2', severity: '阻断' }] });
    expect(r.approved).toBe(false);
    expect(r.reasons).toContain('open_issue:R-2');
  });

  it('缺评分 → 不通过', () => {
    expect(decide({ scores: {}, openIssues: [] }).approved).toBe(false);
  });
});
