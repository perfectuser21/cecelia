import { describe, expect, it, vi } from 'vitest';
import { runCompanyKrProjection, readCompanySnapshot, ingestCompanyCurrent } from '../company-key-results.js';
import { COMPANY_FORMULA, COMPANY_GOALS, COMPANY_GOAL_DATABASE, COMPANY_KR_CATALOG, COMPANY_KR_DATABASE, companyMetric } from '../../lib/company-kr-metrics.js';

function recoveryFixture(failure) {
  const task = { id: 'registered-import', result: {} };
  const rows = COMPANY_KR_CATALOG.map((source, i) => ({ id: `kr-${i}`, unit: source.unit, updated_at: new Date('2026-10-01T00:00:00Z'), metadata: { metric_mode: 'company_formula_v1', company_metric: companyMetric(0, i ? 0 : 1, 5), company_current_baseline: '0', imported_snapshot: { task_id: task.id }, validation_state: 'verified_observation' }, custom_props: { company_notion: { page_id: source.page_id, database_id: COMPANY_KR_DATABASE } } }));
  const pages = COMPANY_KR_CATALOG.map(source => ({ id: source.page_id, parent: { database_id: COMPANY_KR_DATABASE }, last_edited_time: '2026-10-01T00:00:00Z', last_edited_by: { id: 'projection-bot' }, properties: { Name: { title: [{ plain_text: source.title }] }, Goal: { relation: [{ id: source.goal_id }] }, Area: { relation: [] }, Current: { number: 0 }, Target: { number: 5 }, Start: { number: 0 }, Status: { status: { name: 'Open' } } } }));
  let failOnce = true, lockHeld = false;
  const query = vi.fn(async (sql, args = []) => {
    if (sql.includes('pg_try_advisory_lock')) { const acquired = !lockHeld; if (acquired) lockHeld = true; return { rows: [{ acquired }] }; }
    if (sql.includes('pg_advisory_unlock')) { lockHeld = false; return { rows: [{ released: true }] }; }
    if (sql.includes('FROM notion_projection_map')) return { rows: [{ notion_db_id: COMPANY_KR_DATABASE }] };
    if (sql.includes('FROM tasks')) return { rows: [structuredClone(task)] };
    if (sql.includes('FROM key_results')) return { rows: structuredClone(sql.includes('WHERE id=$1') ? rows.filter(r => r.id === args[0]) : rows) };
    if (sql.startsWith('UPDATE tasks')) { task.result = JSON.parse(args[1]); return { rows: [], rowCount: 1 }; }
    if (sql.startsWith('UPDATE key_results')) {
      const row = rows.find(r => r.id === args[0]);
      if (sql.includes('company_current_baseline')) {
        if (failure === 'baseline' && failOnce) { failOnce = false; throw new Error('baseline SQL failed'); }
        row.metadata.company_current_baseline = typeof args[1] === 'string' && args[1].startsWith('"') ? JSON.parse(args[1]) : args[1];
        if (sql.includes("metadata-'company_projection_pending'")) delete row.metadata.company_projection_pending;
      } else if (sql.includes('company_projection_pending')) row.metadata.company_projection_pending = JSON.parse(args[1]);
      else if (sql.includes('metadata=$5')) row.metadata = JSON.parse(args[4]);
      return { rows: [structuredClone(row)], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const pool = { query, connect: async () => ({ query, release() {} }) };
  const notionReq = vi.fn(async (_token, path, method, body) => {
    if (path === '/users/me') return { id: 'projection-bot', type: 'bot' };
    if (path === `/databases/${COMPANY_KR_DATABASE}`) return { properties: Object.fromEntries(Object.entries({ Name: 'title', Current: 'number', Target: 'number', Start: 'number', Progress: 'formula', Goal: 'relation', Area: 'relation', Status: 'status' }).map(([key, type]) => [key, { type, ...(key === 'Progress' ? { formula: { expression: COMPANY_FORMULA } } : {}) }])) };
    if (path.endsWith('/query')) return { results: structuredClone(pages), has_more: false };
    const page = pages.find(p => path.endsWith(p.id));
    if (page) {
      if (method === 'PATCH') {
        Object.assign(page.properties, body.properties);
        if (failure === 'response' && failOnce) { failOnce = false; throw new Error('response timeout after apply'); }
      }
      return structuredClone(page);
    }
    const goal = COMPANY_GOALS.find(g => path.endsWith(g.page_id));
    return { id: goal.page_id, parent: { database_id: COMPANY_GOAL_DATABASE }, properties: { Name: { title: [{ plain_text: goal.title }] }, Area: { relation: [] } } };
  });
  return { pool, notionReq, rows, pages, task };
}

describe('公司库列级投影门', () => {
  it('未登记零请求，无token零写', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) }, notionReq = vi.fn();
    expect(await runCompanyKrProjection(pool, { token: 'fake', notionReq })).toMatchObject({ skipped: true });
    expect(notionReq).not.toHaveBeenCalled();
    expect(await runCompanyKrProjection(pool, { token: null, notionReq })).toMatchObject({ skipped: true });
  });
  it('库schema类型不符必须拒绝，不把其它列当指标', async () => {
    await expect(readCompanySnapshot({ token: 'fake', notionReq: vi.fn(async () => ({ properties: {} })) })).rejects.toThrow();
  });
  it('固定Goal页被移出原Goals库时拒绝来源归属，不伪造源库声明', async () => {
    const fixture = recoveryFixture();
    const notionReq = async (...args) => {
      const page = await fixture.notionReq(...args);
      if (COMPANY_GOALS.some(g => args[1] === `/pages/${g.page_id}`)) page.parent = { database_id: 'wrong-goal-db' };
      return page;
    };
    await expect(readCompanySnapshot({ token: 'fake', notionReq })).rejects.toThrow('Goal来源库归属');
  });
  it.each(['response', 'baseline'])('远端已写但%s丢失：恢复不能把旧机器值当真人覆盖新观察', async failure => {
    const fixture = recoveryFixture(failure);
    await expect(runCompanyKrProjection(fixture.pool, { token: 'fake', notionReq: fixture.notionReq, now: 1000000 })).rejects.toThrow();
    const pending = fixture.rows[0].metadata.company_projection_pending;
    fixture.rows[0].metadata.company_metric = companyMetric(0, 2, 5);
    fixture.rows[0].metadata.last_observation = { actor: 'opc-kr-current', observed_at: '2026-10-01T01:00:00Z' };
    expect(await runCompanyKrProjection(fixture.pool, { token: 'fake', notionReq: fixture.notionReq, now: 1300001 })).toMatchObject({ claims: 0 });
    expect(fixture.rows[0].metadata).toMatchObject({ company_metric: { current: '2' }, validation_state: 'verified_observation', company_current_baseline: '2' });
    expect(fixture.pages[0].properties.Current.number).toBe(2);
    expect(pending).toMatchObject({ value: '1', actor: 'brain-notion-projection' });
    expect(fixture.task.result.metric_observations.some(e => e.kind === 'human_current_claim')).toBe(false);
  });
  it('重启后现场仍旧基线时保留未决尝试、较新观察并留账停推，禁止重发覆盖', async () => {
    const fixture = recoveryFixture('response');
    await expect(runCompanyKrProjection(fixture.pool, { token: 'fake', notionReq: fixture.notionReq, now: 1000000 })).rejects.toThrow();
    fixture.pages[0].properties.Current.number = 0;
    fixture.rows[0].metadata.company_metric = companyMetric(0, 2, 5);
    fixture.notionReq.mockClear();
    for (let i = 0; i < 2; i++) await expect(runCompanyKrProjection({ ...fixture.pool }, { token: 'fake', notionReq: fixture.notionReq, now: 1300001 })).rejects.toThrow('未决');
    expect(fixture.notionReq.mock.calls.some(([, , method]) => method === 'PATCH')).toBe(false);
    expect(fixture.rows[0].metadata).toMatchObject({ company_metric: { current: '2' }, company_projection_pending: { value: '1' }, validation_state: 'verified_observation' });
    expect(fixture.task.result.metric_observations.filter(e => e.kind === 'machine_projection_uncertain')).toHaveLength(1);
  });
  it('未决尝试存在时其它真人Current仍优先；旧机器值迟到不吞掉真人主张', async () => {
    const fixture = recoveryFixture('response');
    await expect(runCompanyKrProjection(fixture.pool, { token: 'fake', notionReq: fixture.notionReq, now: 1000000 })).rejects.toThrow();
    fixture.rows[0].metadata.company_metric = companyMetric(0, 2, 5);
    fixture.pages[0].properties.Current.number = 3; fixture.pages[0].last_edited_by.id = 'human';
    expect(await runCompanyKrProjection(fixture.pool, { token: 'fake', notionReq: fixture.notionReq, now: 1300001 })).toMatchObject({ claims: 1, patched: 0 });
    expect(fixture.rows[0].metadata).toMatchObject({ company_metric: { current: '3' }, company_projection_pending: { value: '1', superseded_by_human: true }, validation_state: 'unverified' });
    fixture.pages[0].properties.Current.number = 1; fixture.pages[0].last_edited_by.id = 'projection-bot';
    expect(await runCompanyKrProjection(fixture.pool, { token: 'fake', notionReq: fixture.notionReq, now: 1600002 })).toMatchObject({ claims: 0, patched: 1 });
    expect(fixture.rows[0].metadata).toMatchObject({ company_metric: { current: '3' }, validation_state: 'unverified' });
    expect(fixture.pages[0].properties.Current.number).toBe(3);
  });
  it('另一进程先核对同一机器尝试时成功响应确认应幂等', async () => {
    const fixture = recoveryFixture();
    const notionReq = async (...args) => {
      const page = await fixture.notionReq(...args);
      if (args[2] === 'PATCH') await ingestCompanyCurrent(fixture.pool, 'kr-0', { page_id: page.id, current: page.properties.Current.number, editor: page.last_edited_by.id, updated_at: page.last_edited_time });
      return page;
    };
    await expect(runCompanyKrProjection(fixture.pool, { token: 'fake', notionReq, now: 1000000 })).resolves.toMatchObject({ patched: 1, claims: 0 });
    expect(fixture.task.result.metric_observations.filter(e => e.kind === 'machine_projection_confirmed')).toHaveLength(1);
  });
  it('现场等于待推机器值但作者变化时无法归因，保留新观察与未决值并留账停推', async () => {
    const fixture = recoveryFixture('response');
    await expect(runCompanyKrProjection(fixture.pool, { token: 'fake', notionReq: fixture.notionReq, now: 1000000 })).rejects.toThrow();
    fixture.rows[0].metadata.company_metric = companyMetric(0, 2, 5);
    fixture.pages[0].last_edited_by.id = 'human-unknown-field-edit'; fixture.notionReq.mockClear();
    await expect(runCompanyKrProjection(fixture.pool, { token: 'fake', notionReq: fixture.notionReq, now: 1300001 })).rejects.toThrow('作者');
    expect(fixture.notionReq.mock.calls.some(([, , method]) => method === 'PATCH')).toBe(false);
    expect(fixture.rows[0].metadata).toMatchObject({ company_metric: { current: '2' }, validation_state: 'verified_observation', company_projection_pending: { value: '1' } });
    expect(fixture.task.result.metric_observations.some(e => e.kind === 'machine_projection_ambiguous')).toBe(true);
    expect(fixture.task.result.metric_observations.some(e => e.kind === 'human_current_claim')).toBe(false);
  });
  it('独立pool整轮须先拿PG会话锁再读snapshot，旧快照不能回滚另一轮Current/Target', async () => {
    const fixture = recoveryFixture();
    let interleaved = false, peer;
    const peerNotionReq = vi.fn((...args) => fixture.notionReq(...args));
    const notionReq = async (...args) => {
      const snapshot = await fixture.notionReq(...args);
      if (!interleaved && args[1].endsWith('/query')) {
        interleaved = true;
        fixture.rows[0].metadata.company_metric = companyMetric(0, 2, 5);
        peer = await runCompanyKrProjection({ ...fixture.pool }, { token: 'fake', notionReq: peerNotionReq, now: 1000000 });
      }
      return snapshot;
    };
    const result = await runCompanyKrProjection(fixture.pool, { token: 'fake', notionReq, now: 1000000 });
    expect(peer).toMatchObject({ skipped: true, reason: 'projection_locked' });
    expect(peerNotionReq).not.toHaveBeenCalled();
    expect(result).toMatchObject({ claims: 0, patched: 1 });
    expect(fixture.rows[0].metadata).toMatchObject({ company_metric: { current: '2' }, company_current_baseline: '2', validation_state: 'verified_observation' });
  });
  it('外部响应失败且解锁也失败时关闭PG连接，保留原失败原因', async () => {
    const fixture = recoveryFixture('response'), release = vi.fn();
    fixture.pool.connect = async () => ({ query: (sql, args) => sql.includes('pg_advisory_unlock') ? Promise.reject(new Error('unlock SQL failed')) : fixture.pool.query(sql, args), release });
    await expect(runCompanyKrProjection(fixture.pool, { token: 'fake', notionReq: fixture.notionReq, now: 1000000 })).rejects.toThrow('response timeout after apply');
    expect(release).toHaveBeenCalledWith(true);
  });
});
