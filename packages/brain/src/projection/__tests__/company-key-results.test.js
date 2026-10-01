import { describe, expect, it, vi } from 'vitest';
import { runCompanyKrProjection } from '../company-key-results.js';
import { fixture } from './company-kr.fixture.js';
import { COMPANY_KR_CATALOG, companyFormalRevision } from '../../lib/company-kr-metrics.js';

describe('公司正式入口和独立AI投影', () => {
  it('未登记或无token不访问Notion', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) }, notionReq = vi.fn();
    expect(await runCompanyKrProjection(pool, { token: 'fake', notionReq })).toMatchObject({ skipped: true });
    expect(await runCompanyKrProjection(pool, { token: null, notionReq })).toMatchObject({ skipped: true });
    expect(notionReq).not.toHaveBeenCalled();
  });




  it('机器只更新AI列，建议可过期，第二轮不产生正式变更或重复PATCH', async () => {
    const f = fixture(); f.kr.metadata.last_observation = { current_value: '2', unit: f.kr.unit };
    f.kr.metadata.company_advice = { suggested_current: '2', suggested_target: '8', formal_revision: companyFormalRevision(f.kr), reason: '继续收集证据', evidence: [{ fact: '实测', source: 'task:1' }], analyzed_at: '2026-10-01T01:00:00Z' };
    const first = await runCompanyKrProjection(f.pool, { token: 'fake', notionReq: f.notionReq, now: 1000000 });
    expect(first.changed_ids).toEqual([]); expect(f.page.properties.Current.number).toBe(1);
    const patches = f.notionReq.mock.calls.filter(([, path, method]) => path.startsWith('/pages/') && method === 'PATCH');
    expect(patches).toHaveLength(1); expect(Object.keys(patches[0][3].properties).every(k => k.startsWith('AI'))).toBe(true);
    expect(f.page.properties['AI建议当前'].number).toBe(2);
    f.notionReq.mockClear();
    expect((await runCompanyKrProjection(f.pool, { token: 'fake', notionReq: f.notionReq, now: 1300001 })).changed_ids).toEqual([]);
    expect(f.notionReq.mock.calls.filter(([, , method]) => method === 'PATCH')).toHaveLength(0);
    f.page.properties.Target.number = 10;
    expect((await runCompanyKrProjection(f.pool, { token: 'fake', notionReq: f.notionReq, now: 1600002 })).changed_ids).toEqual(['kr']);
    expect(f.page.properties['AI分析状态'].rich_text[0].text.content).toMatch(/过期/);
  });
  it('页明确归档才停止active；查询缺失或404不能伪造归档', async () => {
    const f = fixture(); f.pages.length = 0;
    const missing = await runCompanyKrProjection(f.pool, { token: 'fake', notionReq: f.notionReq, now: 1000000 });
    expect(missing.changed_ids).toEqual(['kr']); expect(f.kr.metadata.company_source_archived).toBeFalsy(); expect(f.kr.metadata.company_sync_error).toBeTruthy();
    f.pages.push(f.page); f.page.archived = true;
    expect((await runCompanyKrProjection(f.pool, { token: 'fake', notionReq: f.notionReq, now: 1300001 })).changed_ids).toEqual(['kr']);
    expect(f.kr.metadata.company_source_archived).toBeTruthy();
  });
  it('整轮持有PG锁，另一进程不读取过时snapshot', async () => {
    const f = fixture(); let peer;
    const notionReq = async (...args) => { if (args[1].endsWith('/query')) peer = await runCompanyKrProjection({ ...f.pool }, { token: 'fake', notionReq: f.notionReq, now: 1000000 }); return f.notionReq(...args); };
    await runCompanyKrProjection(f.pool, { token: 'fake', notionReq, now: 1000000 });
    expect(peer).toMatchObject({ skipped: true, reason: 'projection_locked' });
  });
});



it('已纳入KR来源不完整或不可读时停止分析，修复有效来源后恢复', async () => {
  const { isActiveCompanyKr } = await import('../../lib/company-kr-metrics.js');
  const f = fixture(), revision = companyFormalRevision(f.kr);
  f.page.properties.Goal.relation = [];
  expect((await runCompanyKrProjection(f.pool, { token: 'fake', notionReq: f.notionReq, now: 1000000 })).changed_ids).toEqual(['kr']);
  expect(f.kr.metadata.company_sync_error).toMatchObject({ reason: expect.stringContaining('Goal') });
  expect(isActiveCompanyKr(f.kr)).toBe(false);
  const invalidRevision = companyFormalRevision(f.kr); expect(invalidRevision).not.toBe(revision);
  expect((await runCompanyKrProjection(f.pool, { token: 'fake', notionReq: f.notionReq, now: 1300001 })).changed_ids).toEqual([]);
  expect(companyFormalRevision(f.kr)).toBe(invalidRevision);
  f.page.properties.Goal.relation = [{ id: COMPANY_KR_CATALOG[0].goal_id }];
  expect((await runCompanyKrProjection(f.pool, { token: 'fake', notionReq: f.notionReq, now: 1600002 })).changed_ids).toEqual(['kr']);
  expect(f.kr.metadata.company_sync_error).toBeUndefined(); expect(isActiveCompanyKr(f.kr)).toBe(true);
});
