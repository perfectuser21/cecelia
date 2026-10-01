import { describe, expect, it, vi } from 'vitest';
import { runCompanyKrProjection, readCompanySnapshot, ingestCompanyCurrent } from '../company-key-results.js';
import { COMPANY_FORMULA, COMPANY_GOALS, COMPANY_GOAL_DATABASE, COMPANY_KR_CATALOG, COMPANY_KR_DATABASE, companyMetric, companyFormalRevision } from '../../lib/company-kr-metrics.js';

export function fixture() {
  const source = COMPANY_KR_CATALOG[0];
  const task = { id: 'registered-import', result: {} };
  const kr = { id: 'kr', title: source.title, objective_id: 'objective', unit: source.unit, status: 'active', updated_at: '2026-10-01T00:00:00Z', metadata: { metric_mode: 'company_formula_v1', company_metric: companyMetric(0, 1, 5), company_status: 'Open', imported_snapshot: { task_id: task.id }, validation_state: 'unverified' }, custom_props: { company_notion: { page_id: source.page_id, database_id: COMPANY_KR_DATABASE, goal_id: source.goal_id, area_ids: [] } } };
  const page = { id: source.page_id, parent: { database_id: COMPANY_KR_DATABASE }, last_edited_time: '2026-10-01T00:00:00Z', properties: { Name: { title: [{ plain_text: source.title }] }, Goal: { relation: [{ id: source.goal_id }] }, Area: { relation: [] }, Current: { number: 1 }, Target: { number: 5 }, Start: { number: 0 }, Status: { status: { name: 'Open' } } } };
  const rows = [kr], pages = [page]; let lockHeld = false;
  const query = vi.fn(async (sql, args = []) => {
    if (sql.includes('pg_try_advisory_lock')) { const acquired = !lockHeld; if (acquired) lockHeld = true; return { rows: [{ acquired }] }; }
    if (sql.includes('pg_advisory_unlock')) { lockHeld = false; return { rows: [{}] }; }
    if (sql.includes('FROM notion_projection_map')) return { rows: [{ notion_db_id: COMPANY_KR_DATABASE, vessel: 'notion-company-key-results', face: 'inlet' }] };
    if (sql.includes('FROM tasks')) return { rows: [structuredClone(task)] };
    if (sql.includes('FROM objectives')) return { rows: [{ id: 'objective', title: COMPANY_GOALS[0].title, metadata: { source_system: 'notion-company-okr' }, custom_props: { company_notion: { database_id: COMPANY_GOAL_DATABASE } } }] };
    if (sql.includes('FROM key_results')) return { rows: structuredClone(sql.includes('WHERE id=$1') ? rows.filter(r => r.id === args[0]) : rows) };
    if (sql.startsWith('UPDATE tasks')) { task.result = JSON.parse(args[1]); return { rows: [] }; }
    if (sql.startsWith('UPDATE key_results')) {
      const row = rows.find(r => r.id === args[0]);
      for (const value of args) {
        if (typeof value === 'string' && value.startsWith('{')) {
          const obj = JSON.parse(value);
          if (obj.metric_mode) row.metadata = obj;
          if (obj.company_notion) row.custom_props = obj;
        }
      }
      if (sql.includes('title=$2')) { row.title = args[1]; row.status = args[2]; row.unit = args[3]; row.objective_id = args[4]; }
      return { rows: [structuredClone(row)] };
    }
    return { rows: [] };
  });
  const schema = { properties: Object.fromEntries(Object.entries({ Name: 'title', Current: 'number', Target: 'number', Start: 'number', Progress: 'formula', Goal: 'relation', Area: 'relation', Status: 'status' }).map(([key, type]) => [key, { type, ...(key === 'Progress' ? { formula: { expression: COMPANY_FORMULA } } : {}) }])) };
  const notionReq = vi.fn(async (_token, path, method, body) => {
    if (path === `/databases/${COMPANY_KR_DATABASE}`) { if (method === 'PATCH') for (const [key, value] of Object.entries(body.properties)) schema.properties[key] = { type: Object.keys(value)[0], ...value }; return structuredClone(schema); }
    if (path.endsWith('/query')) return { results: structuredClone(pages.filter(p => !p.archived && !p.in_trash)), has_more: false };
    const p = pages.find(p => path.endsWith(p.id));
    if (p) { if (method === 'PATCH') Object.assign(p.properties, body.properties); return structuredClone(p); }
    const goal = COMPANY_GOALS.find(g => path.endsWith(g.page_id));
    if (goal) return { id: goal.page_id, parent: { database_id: COMPANY_GOAL_DATABASE }, properties: { Name: { title: [{ plain_text: goal.title }] }, Area: { relation: [] } } };
    throw new Error('page unavailable');
  });
  return { pool: { query, connect: async () => ({ query, release() {} }) }, notionReq, rows, pages, task, kr, page, schema };
}

describe('公司正式入口和独立AI投影', () => {
  it('未登记或无token不访问Notion', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) }, notionReq = vi.fn();
    expect(await runCompanyKrProjection(pool, { token: 'fake', notionReq })).toMatchObject({ skipped: true });
    expect(await runCompanyKrProjection(pool, { token: null, notionReq })).toMatchObject({ skipped: true });
    expect(notionReq).not.toHaveBeenCalled();
  });
  it('保留原公式与列类型门禁', async () => {
    await expect(readCompanySnapshot({ token: 'fake', notionReq: async () => ({ properties: {} }) })).rejects.toThrow();
  });
  it('动态成员按来源ID读取，新空页单独反馈，不阻断已有KR', async () => {
    const f = fixture(); f.pages.push({ ...structuredClone(f.page), id: 'new', properties: { ...structuredClone(f.page.properties), Goal: { relation: [] } } });
    const snapshot = await readCompanySnapshot({ token: 'fake', notionReq: f.notionReq });
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.errors).toEqual(expect.arrayContaining([expect.objectContaining({ page_id: 'new' })]));
    expect(snapshot.complete).toBe(true);
  });
  it('新增Goal须验证原GoalDB，错误归属作为页反馈', async () => {
    const f = fixture();
    const notionReq = async (...args) => { const page = await f.notionReq(...args); if (args[1] === `/pages/${COMPANY_GOALS[0].page_id}`) page.parent.database_id = 'wrong'; return page; };
    const snapshot = await readCompanySnapshot({ token: 'fake', notionReq });
    expect(snapshot.records).toHaveLength(0); expect(snapshot.errors[0].error).toMatch(/Goal.*归属/);
  });
  it('正式Current人赢并保存旧pending证据，独立观察不被覆盖', async () => {
    const f = fixture(); f.kr.metadata.last_observation = { current_value: '7' }; f.kr.metadata.company_projection_pending = { value: '9', attempt_id: 'legacy' };
    const result = await ingestCompanyCurrent(f.pool, 'kr', { page_id: f.page.id, current: 3, updated_at: f.page.last_edited_time });
    expect(result.kr.metadata).toMatchObject({ company_metric: { current: '3' }, last_observation: { current_value: '7' } });
    expect(result.kr.metadata.company_projection_pending).toBeUndefined();
    expect(f.task.result.metric_observations.some(r => r.superseded_machine_attempt?.attempt_id === 'legacy')).toBe(true);
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

it('AI状态用中文区分失败与完成，正式版本过期优先于旧排队状态', async () => {
  const { companyAiProperties } = await import('../company-kr-notion.js');
  const f = fixture();
  f.kr.metadata.company_analysis = { status: 'completed_no_pr' };
  expect(companyAiProperties(f.kr)['AI分析状态'].rich_text[0].text.content).toBe('分析完成，尚无有效建议');
  f.kr.metadata.company_advice = { formal_revision: 'old', reason: '旧建议' };
  f.kr.metadata.company_analysis.status = 'queued';
  expect(companyAiProperties(f.kr)['AI分析状态'].rich_text[0].text.content).toContain('过期');
  f.kr.metadata.company_status = 'Paused';
  expect(companyAiProperties(f.kr)['AI分析状态'].rich_text[0].text.content).toContain('停止分析');
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
