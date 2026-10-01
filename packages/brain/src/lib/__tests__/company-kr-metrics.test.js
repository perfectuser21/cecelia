import { describe, expect, it } from 'vitest';
import { companyMetric, companyKrView, companyPatchIsReserved, COMPANY_KR_CATALOG } from '../company-kr-metrics.js';

describe('公司KR原口径', () => {
  it('保留原三位fraction与原值，不把current百分比化', () => {
    expect(companyMetric('0', '1.234', '5')).toEqual({ start: '0', current: '1.234', target: '5', ratio: 0.247, ratio_state: 'defined' });
  });
  it('递减与超目标均按原formula，不clamp', () => {
    expect(companyMetric('10', '4', '2').ratio).toBe(0.75);
    expect(companyMetric('0', '12', '8').ratio).toBe(1.5);
    expect(companyMetric('0', '-2', '8').ratio).toBe(-0.25);
  });
  it('零分母、缺失及NaN不得隐式0', () => {
    for (const args of [[0, 0, 0], [0, null, 8], [0, 'NaN', 8]]) {
      expect(companyMetric(...args)).toMatchObject({ ratio: null, ratio_state: 'undefined' });
    }
  });
  it('公司view读取raw精度，泛PATCH不能清模式；非保留元数据可merge', () => {
    const kr = { id: 'kr', title: '标题', current_value: '1.23', target_value: '5.00', progress: 25, unit: '条/周', metadata: { metric_mode: 'company_formula_v1', company_metric: companyMetric(0, '1.234', 5), validation_state: 'unverified' }, custom_props: { company_notion: { page_id: 'source', goal_id: 'goal', area_ids: [] } }, updated_at: new Date('2026-10-01T00:00:00Z') };
    expect(companyKrView(kr)).toMatchObject({ current_value: '1.234', progress_ratio: 0.247, progress_pct: 24.7, source_area_ids: [], validation_state: 'unverified' });
    expect(companyPatchIsReserved({ current_value: 3 })).toBe(true);
    expect(companyPatchIsReserved({ metadata: { metric_mode: null } })).toBe(true);
    expect(companyPatchIsReserved({ custom_props: { company_notion: null } })).toBe(true);
    expect(companyPatchIsReserved({ metadata: { meeting_note: '记录' } })).toBe(false);
    expect(COMPANY_KR_CATALOG).toHaveLength(8);
  });
});
