import { describe, expect, it, vi } from 'vitest';
import { ingestCompanyFormal, ingestCompanyCurrent, ingestCompanyTarget, markCompanySyncError } from '../company-kr-inlet.js';
import { companyFormalRevision, isActiveCompanyKr } from '../../lib/company-kr-metrics.js';
import { fixture } from './company-kr.fixture.js';

describe('公司正式入站事务', () => {
  it('正式Current人赢并保存旧pending证据，独立观察不被覆盖', async () => {
    const f = fixture(); f.kr.metadata.last_observation = { current_value: '7' }; f.kr.metadata.company_projection_pending = { value: '9', attempt_id: 'legacy' };
    const result = await ingestCompanyCurrent(f.pool, 'kr', { page_id: f.page.id, current: 3, updated_at: f.page.last_edited_time });
    expect(result.kr.metadata).toMatchObject({ company_metric: { current: '3' }, last_observation: { current_value: '7' } });
    expect(result.kr.metadata.company_projection_pending).toBeUndefined();
    expect(f.task.result.metric_observations.some(r => r.superseded_machine_attempt?.attempt_id === 'legacy')).toBe(true);
  });
});

it('拒绝错误sourcepage，回滚并释放连接，不写任何实体或收据', async () => {
  const f = fixture(), release = vi.fn();
  const pool = { connect: async () => ({ query: f.pool.query, release }) };
  await expect(ingestCompanyFormal(pool, f.kr.id, { page_id: 'foreign', current: 99 })).rejects.toThrow('来源不匹配');
  const sql = f.pool.query.mock.calls.map(([sql]) => sql);
  expect(sql.at(-1)).toBe('ROLLBACK'); expect(sql).not.toContain('COMMIT');
  expect(sql.some(sql => /^(UPDATE|INSERT)/.test(sql))).toBe(false);
  expect(release).toHaveBeenCalledOnce();
});

it('正式变化写后若来源收据失败，回滚整个事务且不写任务成功事件', async () => {
  const f = fixture(), release = vi.fn();
  const query = vi.fn(async (sql, args) => {
    if (sql.includes('INSERT INTO notion_ingest_receipts')) throw new Error('收据表写入失败');
    return f.pool.query(sql, args);
  });
  await expect(ingestCompanyCurrent({ connect: async () => ({ query, release }) }, f.kr.id,
    { page_id: f.page.id, current: 3, updated_at: f.page.last_edited_time })).rejects.toThrow('收据表写入失败');
  const statements = query.mock.calls.map(([sql]) => sql);
  expect(statements.some(sql => sql.startsWith('UPDATE key_results'))).toBe(true);
  expect(statements.at(-1)).toBe('ROLLBACK'); expect(statements).not.toContain('COMMIT');
  expect(statements.some(sql => sql.startsWith('UPDATE tasks'))).toBe(false);
  expect(release).toHaveBeenCalledOnce();
});

it('只有AI列编辑或回读同值时不产生正式变更与任务事件', async () => {
  const f = fixture();
  const before = companyFormalRevision(f.kr);
  const result = await ingestCompanyFormal(f.pool, f.kr.id, { page_id: f.page.id, current: 1, start: 0, target: 5,
    updated_at: '2026-10-01T03:00:00Z', editor: 'ai-projection' });
  expect(result).toMatchObject({ changed: false, claimed: false });
  expect(companyFormalRevision(result.kr)).toBe(before);
  expect(f.pool.query.mock.calls.some(([sql]) => /^(UPDATE|INSERT)/.test(sql))).toBe(false);
});

it('人改Target按原公式保留Current和独立观察，映射变化同步落任务账', async () => {
  const f = fixture(); f.kr.metadata.last_observation = { current_value: '7', evidence: [{ fact: '采集', source: 'collector' }] };
  const target = await ingestCompanyTarget(f.pool, f.kr.id, { page_id: f.page.id, start: 0, target: 10 });
  expect(target.metadata).toMatchObject({ company_metric: { current: '1', target: '10', ratio: 0.1 }, last_observation: { current_value: '7' } });
  const changed = await ingestCompanyFormal(f.pool, f.kr.id, { page_id: f.page.id, title: '更名', status: 'Paused', goal_id: 'new-goal', area_ids: ['area'] }, { objectiveId: 'new-objective' });
  expect(changed.kr).toMatchObject({ title: '更名', objective_id: 'new-objective', custom_props: { company_notion: { goal_id: 'new-goal', area_ids: ['area'] } } });
  expect(isActiveCompanyKr(changed.kr)).toBe(false);
  expect(f.task.result.metric_observations).toHaveLength(2);
});

it('同步错误只在有效性改变时换revision，恢复来源后恢复分析', async () => {
  const f = fixture(), original = companyFormalRevision(f.kr);
  expect(await markCompanySyncError(f.pool, f.kr.id, 'Goal缺失')).toEqual({ changed: true });
  expect(isActiveCompanyKr(f.kr)).toBe(false);
  const invalid = companyFormalRevision(f.kr);
  expect(invalid).not.toBe(original);
  expect(await markCompanySyncError(f.pool, f.kr.id, 'Goal缺失')).toEqual({ changed: false });
  expect(f.task.result.metric_observations).toHaveLength(1);
  expect(await markCompanySyncError(f.pool, f.kr.id, '来源不可读')).toEqual({ changed: false });
  expect(companyFormalRevision(f.kr)).toBe(invalid);
  const restored = await ingestCompanyFormal(f.pool, f.kr.id, { page_id: f.page.id, current: 1 });
  expect(restored.changed).toBe(true); expect(isActiveCompanyKr(restored.kr)).toBe(true);
  expect(restored.kr.metadata.company_sync_error).toBeUndefined();
});
