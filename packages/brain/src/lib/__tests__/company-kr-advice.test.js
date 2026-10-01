import { describe, expect, it, vi } from 'vitest';
import { companyFormalRevision, companyMetric } from '../company-kr-metrics.js';
import * as module from '../company-kr-advice.js';

function fixture() {
  const kr = { id: 'kr', title: 'KR', unit: '条', status: 'active', updated_at: '2026-10-01T00:00:00Z', metadata: { metric_mode: 'company_formula_v1', company_metric: companyMetric(0, 1, 5) }, custom_props: { company_notion: { page_id: 'page' } } };
  const revision = companyFormalRevision(kr);
  const task = { id: 'task', status: 'in_progress', task_type: 'qiumi_task', executor_kind: 'openclaw-agent', result: {}, payload: { company_kr_analysis: { version: 1, snapshot_id: 'snapshot', items: [{ id: kr.id, source_page_id: 'page', formal_revision: revision }] } } };
  const input = { task_id: 'task', actor: 'brain-openclaw-reaper', source_page_id: 'page', formal_revision: revision, suggested_current: '2.345', suggested_target: null, reason: '有实测，目标暂无充分证据', evidence: [{ fact: '实测2.345条', source: 'task:observation' }], analyzed_at: '2026-10-01T01:00:00Z', idempotency_key: 'task:kr' };
  task.payload.company_kr_analysis.items[0].evidence = input.evidence;
  task.payload.company_kr_analysis.items[0].observation = { current_value: '2.345', evidence: input.evidence };
  const query = vi.fn(async (sql, args) => {
    if (sql.includes('FROM tasks')) return { rows: [task] };
    if (sql.includes('FROM key_results')) return { rows: [kr] };
    if (sql.startsWith('UPDATE key_results')) { kr.metadata = JSON.parse(args[1]); return { rows: [kr] }; }
    if (sql.startsWith('UPDATE tasks')) task.result = JSON.parse(args[1]);
    return { rows: [] };
  });
  return { kr, task, input, query, pool: { connect: async () => ({ query, release() {} }) } };
}
describe('公司KR建议可信回执', () => {
  it('建议与任务证据原子落账，正式值不变且完成后重复回执零写', async () => {
    const f = fixture();
    expect(typeof module.saveCompanyAdvice).toBe('function');
    const result = await module.saveCompanyAdvice(f.pool, 'kr', f.input);
    expect(result.item).toMatchObject({ current_value: '1', target_value: '5', formal_revision: f.input.formal_revision, advice: { suggested_current: '2.345', suggested_target: null, stale: false } });
    expect(f.task.result.company_kr_advice).toHaveLength(1);
    f.task.status = 'completed'; f.query.mockClear();
    expect(await module.saveCompanyAdvice(f.pool, 'kr', f.input)).toMatchObject({ duplicate: true });
    expect(f.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
  });
  it.each(['stale', 'foreign_task', 'foreign_source', 'paused', 'actor', 'extra_field', 'evidence', 'duplicate_conflict'])('拒绝%s并且不写正式或建议', async type => {
    const f = fixture(); expect(typeof module.saveCompanyAdvice).toBe('function');
    if (type === 'stale') f.kr.metadata.company_metric.target = '9';
    if (type === 'foreign_task') f.task.payload = {};
    if (type === 'foreign_source') f.input.source_page_id = 'foreign';
    if (type === 'paused') f.kr.metadata.company_status = 'Paused';
    if (type === 'actor') f.input.actor = 'ai-client';
    if (type === 'extra_field') f.input.current_value = 9;
    if (type === 'evidence') f.input.evidence = [];
    if (type === 'duplicate_conflict') { await module.saveCompanyAdvice(f.pool, 'kr', f.input); f.input.reason = '不同理由'; f.query.mockClear(); }
    await expect(module.saveCompanyAdvice(f.pool, 'kr', f.input)).rejects.toThrow();
    expect(f.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
  });
});

it('同一建议重收时收割时间变化仍是重复，保留第一次时间', async () => {
  const f = fixture();
  await module.saveCompanyAdvice(f.pool, 'kr', f.input);
  f.query.mockClear();
  const retried = await module.saveCompanyAdvice(f.pool, 'kr', { ...f.input, analyzed_at: '2026-10-01T03:00:00Z' });
  expect(retried).toMatchObject({ duplicate: true, receipt: { analyzed_at: f.input.analyzed_at } });
  expect(f.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
});
it.each(['foreign_evidence', 'invented_fact', 'no_observation', 'unproven_observation', 'different_measurement'])('持久化拒绝%s', async type => {
  const f = fixture(), item = f.task.payload.company_kr_analysis.items[0];
  if (type === 'foreign_evidence') f.input.evidence = [{ fact: '实测2.345条', source: 'outside:source' }];
  if (type === 'invented_fact') f.input.evidence = [{ fact: '编造的采集值', source: 'task:observation' }];
  if (type === 'no_observation') item.observation = null;
  if (type === 'unproven_observation') item.observation.evidence = [];
  if (type === 'different_measurement') f.input.suggested_current = 99;
  await expect(module.saveCompanyAdvice(f.pool, 'kr', f.input)).rejects.toThrow();
  expect(f.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
});
