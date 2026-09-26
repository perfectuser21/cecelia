import { describe, it, expect } from 'vitest';
import { evaluateAreaForPromotion, SURVIVAL_TRIAL_DAYS, SURVIVAL_MAX_GAP_DAYS } from './org-unit-promotion.js';

function days(pattern, startDate = '2026-09-01') {
  const start = new Date(startDate);
  return pattern.split('').map((c, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return { date: d.toISOString().slice(0, 10), hasEvidence: c === '1' };
  });
}

describe('evaluateAreaForPromotion', () => {
  it('areaId 缺失 → 不合格', () => {
    expect(evaluateAreaForPromotion(null, { recentDays: days('1111111') }))
      .toEqual({ eligible: false, reason: 'areaId is required' });
  });

  it('recentDays 为空 → 不合格', () => {
    const r = evaluateAreaForPromotion('area-1', { recentDays: [] });
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/no ops evidence data/);
  });

  it('数据不足 7 天 → 不合格', () => {
    const r = evaluateAreaForPromotion('area-1', { recentDays: days('111') });
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/试用期数据不足/);
  });

  it('7 天全部有交卷证据 → 合格', () => {
    const r = evaluateAreaForPromotion('area-1', { recentDays: days('1111111') });
    expect(r.eligible).toBe(true);
  });

  it('7 天内偶发 1-2 天无证据（未连续 3 天）→ 仍合格', () => {
    const r = evaluateAreaForPromotion('area-1', { recentDays: days('1101101') });
    expect(r.eligible).toBe(true);
  });

  it('连续 3 天无交卷证据 → 判不合格（触发降级阈值）', () => {
    const r = evaluateAreaForPromotion('area-1', { recentDays: days('1110001') });
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/连续 3 天无交卷证据/);
  });

  it('连续无证据超过阈值（4 天）→ 判不合格', () => {
    const r = evaluateAreaForPromotion('area-1', { recentDays: days('1000011') });
    expect(r.eligible).toBe(false);
  });

  it('只看最近 7 天窗口：更早的间隔不影响判定', () => {
    // 前 3 天无证据发生在 8 天前的窗口外，最近 7 天全绿
    const r = evaluateAreaForPromotion('area-1', { recentDays: days('0001111111') });
    expect(r.eligible).toBe(true);
  });

  it('导出常量与决策 de1e9ba9 描述一致：7 天试用期 / 3 天降级阈值', () => {
    expect(SURVIVAL_TRIAL_DAYS).toBe(7);
    expect(SURVIVAL_MAX_GAP_DAYS).toBe(3);
  });
});
