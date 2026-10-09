import { describe, expect, it, vi } from 'vitest';
import { observeCompanyKr } from '../company-kr-observations.js';

describe('公司测量必须有任务与证据', () => {
  it('无证据或无task_id零写', async () => {
    const pool = { connect: vi.fn() };
    await expect(observeCompanyKr(pool, 'kr', { current_value: 0 })).rejects.toThrow();
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it('拒绝缺少source/fact的证据，即使有值0', async () => {
    const pool = { connect: vi.fn() };
    await expect(observeCompanyKr(pool, 'kr', { task_id: 'task', actor: 'manager', current_value: 0, observed_at: '2026-10-01T00:00:00Z', evidence: [{}] })).rejects.toThrow();
    expect(pool.connect).not.toHaveBeenCalled();
  });
});

it('观察只写独立last_observation，不改变正式值/进度/验证状态', async () => {
  const kr = { id: 'kr', unit: '条', status: 'active', updated_at: '2026-10-01T00:00:00Z', current_value: '1.00', progress: 20, progress_pct: 20, metadata: { metric_mode: 'company_formula_v1', validation_state: 'unverified', company_metric: { start: '0', current: '1', target: '5', ratio: 0.2 } }, custom_props: { company_notion: { page_id: 'page' } } };
  const task = { id: 'task', result: {} };
  const writes = [];
  const query = vi.fn(async (sql, args) => {
    if (sql.startsWith('SELECT') && sql.includes('FROM tasks')) return { rows: [task] };
    if (sql.startsWith('SELECT') && sql.includes('FROM key_results')) return { rows: [kr] };
    if (sql.startsWith('UPDATE key_results')) { writes.push(sql); kr.metadata = JSON.parse(args.find(a => typeof a === 'string' && a.startsWith('{'))); return { rows: [kr] }; }
    return { rows: [] };
  });
  const result = await observeCompanyKr({ connect: async () => ({ query, release() {} }) }, 'kr', { task_id: 'task', actor: 'observer', source_page_id: 'page', unit: '条', current_value: 3, observed_at: '2026-10-01T01:00:00Z', expected_updated_at: kr.updated_at, idempotency_key: 'obs1', evidence: [{ fact: '实测3条', source: 'fixture:count' }] });
  expect(result.item).toMatchObject({ current_value: '1', observation: { current_value: '3', unit: '条' }, validation_state: 'unverified', progress_ratio: 0.2 });
  expect(writes.every(sql => !/SET current_value|progress=|progress_pct=/.test(sql))).toBe(true);
});
