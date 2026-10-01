import { describe, expect, it } from 'vitest';
import { companyMetric, companyKrView, companyPatchIsReserved, COMPANY_KR_CATALOG } from '../company-kr-metrics.js';

describe('公司KR原口径', () => {
  it('观察版本保留PG微秒，不能将同毫秒两次更新混为同版本', () => {
    const kr = { updated_at: new Date('2026-10-01T00:00:00.123Z'), observation_version: '2026-10-01 00:00:00.123456+00' };
    expect(companyKrView(kr).updated_at).toBe('2026-10-01T00:00:00.123456+00:00');
  });
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

it('正式版本只跟正式字段变化，观察和建议独立展示', () => {
  const kr = { id: 'kr', title: '标题', status: 'active', unit: '条', updated_at: '2026-10-01T00:00:00Z', metadata: { metric_mode: 'company_formula_v1', company_status: 'Open', company_metric: companyMetric(0, 1, 5) }, custom_props: { company_notion: { page_id: 'source', goal_id: 'goal', area_ids: ['b', 'a'] } } };
  const before = companyKrView(kr);
  expect(before.formal_revision).toMatch(/^[a-f0-9]{64}$/);
  kr.metadata.last_observation = { current_value: '2', unit: '条', evidence: [{ fact: '实测', source: 'task:1' }] };
  kr.metadata.company_advice = { suggested_current: '2', suggested_target: '8', formal_revision: before.formal_revision };
  kr.updated_at = '2026-10-01T01:00:00Z';
  expect(companyKrView(kr)).toMatchObject({ formal_revision: before.formal_revision, current_value: '1', observation: kr.metadata.last_observation, advice: { suggested_current: '2', stale: false } });
  kr.metadata.company_metric = companyMetric(0, 3, 5);
  expect(companyKrView(kr).formal_revision).not.toBe(before.formal_revision);
  expect(companyKrView(kr).advice.stale).toBe(true);
  for (const key of ['company_advice', 'company_formal_revision', 'company_source_archived', 'last_formal_inlet']) expect(companyPatchIsReserved({ metadata: { [key]: {} } })).toBe(true);
});
