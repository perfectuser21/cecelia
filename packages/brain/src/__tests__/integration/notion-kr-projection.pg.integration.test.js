import { describe, it, expect } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { runNotionKrProjection, KR_DB_PROPERTIES, configureKrProjection, KR_PROJECTION_VESSEL } from '../../projection/key-results.js';
import express from 'express';
import request from 'supertest';
import { createCompanyKrRouter } from '../../routes/company-key-results.js';
import { COMPANY_GOALS, COMPANY_GOAL_DATABASE, COMPANY_KR_CATALOG, COMPANY_KR_DATABASE, COMPANY_FORMULA, COMPANY_KR_SQL_GUARD, assertCompanyPatch } from '../../lib/company-kr-metrics.js';
import { runCompanyKrProjection } from '../../projection/company-key-results.js';
import { saveCompanyAdvice } from '../../lib/company-kr-advice.js';

describe('独立 KR 投影真实 PostgreSQL', () => {
  it('原始指标独立投影、链接真实入库且第二轮零远程写，事务最终回滚', async () => {
    const pool = new pg.Pool({ host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME || 'cecelia_test', user: process.env.DB_USER || 'cecelia', password: process.env.DB_PASSWORD });
    const client = await pool.connect();
    const krId = randomUUID(), dbId = randomUUID(), pageId = randomUUID();
    const pages = new Map();
    const requests = [];
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE notion_projection_map SET status='dormant' WHERE brain_table='key_results'`);
      await client.query(`INSERT INTO notion_projection_map(notion_db_id,title,face,brain_table,direction,vessel,status)
        VALUES ($1,'Brain Key Results','mirror','key_results','push','notion-kr-projection','active')`, [dbId]);
      await client.query(`INSERT INTO key_results(id,title,status,progress,current_value,target_value,unit,metadata)
        VALUES ($1,'投影集成验收','active',25,2,8,'条','{"progress_source":"projects_v1"}')`, [krId]);
      // 单事务内可见真实目标行；只限定读集，不替代任何投影 SQL 写入。
      const scoped = { query: (sql, args) => client.query(sql.includes('FROM key_results kr')
        ? sql.replace('ORDER BY kr.updated_at, kr.id', `WHERE kr.id='${krId}' ORDER BY kr.updated_at, kr.id`) : sql, args) };
      const notionReq = async (_token, path, method, body) => {
        requests.push({ path, method, body });
        if (path === `/databases/${dbId}`) return { title: [{ plain_text: 'Brain Key Results' }],
          properties: Object.fromEntries(Object.entries(KR_DB_PROPERTIES).map(([name, spec]) => [name, { type: Object.keys(spec)[0] }])) };
        if (path.endsWith('/query')) return { results: [] };
        if (path === `/pages/${pageId}` && method === 'GET') return { parent: { database_id: dbId }, properties: pages.get(pageId).properties };
        if (path === '/pages') { pages.set(pageId, body); return { id: pageId }; }
        throw new Error(`未预期 Notion 请求: ${path}`);
      };
      const now = Date.now();
      expect(await runNotionKrProjection(scoped, { token: 'fake', notionReq, now })).toMatchObject({ created: 1 });
      const link = await client.query(`SELECT external_id,content_hash FROM projection_links WHERE target='notion' AND entity_type='key_results' AND entity_id=$1`, [krId]);
      expect(link.rows).toHaveLength(1);
      expect(link.rows[0].external_id).toBe(pageId);
      expect(link.rows[0].content_hash).toMatch(/^[a-f0-9]{40}$/);
      expect(pages.get(pageId).properties.Current.number).toBe(2);
      expect(pages.get(pageId).properties.Target.number).toBe(8);
      expect(pages.get(pageId).properties.Progress.number).toBe(25);
      requests.length = 0;
      expect(await runNotionKrProjection(scoped, { token: 'fake', notionReq, now: now + 300001 })).toMatchObject({ skipped: 1 });
      expect(requests.every(r => r.method === 'GET')).toBe(true);
      expect(requests.some(r => r.path === `/pages/${pageId}`)).toBe(true);
      const unchanged = (await client.query('SELECT progress,current_value,target_value FROM key_results WHERE id=$1', [krId])).rows[0];
      expect([unchanged.progress, Number(unchanged.current_value), Number(unchanged.target_value)]).toEqual([25, 2, 8]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  });
});

describe('公司KR真实SQL与HTTP', () => {
  it('正式值隔离、AI建议任务账、动态成员与Notion同表闭环，事务回滚', async () => {
    const pool = new pg.Pool({ host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 5432), database: process.env.DB_NAME || 'cecelia_test', user: process.env.DB_USER || 'cecelia', password: process.env.DB_PASSWORD });
    const client = await pool.connect();
    let serial = 0, projectionTime = Date.now();
    const scoped = { query: (...args) => client.query(...args), connect: async () => {
      const savepoint = `company_${++serial}`;
      return { query: (sql, args) => client.query(sql === 'BEGIN' ? `SAVEPOINT ${savepoint}` : sql === 'COMMIT' ? `RELEASE SAVEPOINT ${savepoint}` : sql === 'ROLLBACK' ? `ROLLBACK TO SAVEPOINT ${savepoint}` : sql, args), release() {} };
    } };
    const title = value => ({ title: [{ plain_text: value }] });
    const remote = new Map(), goals = new Map(), requests = [];
    for (const source of COMPANY_KR_CATALOG) remote.set(source.page_id, { id: source.page_id, parent: { database_id: COMPANY_KR_DATABASE }, last_edited_time: '2026-10-01T00:00:00Z', properties: { Name: title(source.title), Goal: { relation: [{ id: source.goal_id }] }, Area: { relation: [] }, Current: { number: 1.234 }, Start: { number: 0 }, Target: { number: 5 }, Status: { status: { name: 'Open' } } } });
    for (const goal of COMPANY_GOALS) goals.set(goal.page_id, { id: goal.page_id, parent: { database_id: COMPANY_GOAL_DATABASE }, properties: { Name: title(goal.title), Area: { relation: [] } } });
    const schema = { properties: Object.fromEntries(Object.entries({ Name: 'title', Current: 'number', Target: 'number', Start: 'number', Progress: 'formula', Goal: 'relation', Area: 'relation', Status: 'status' }).map(([name, type]) => [name, { type, ...(name === 'Progress' ? { formula: { expression: COMPANY_FORMULA } } : {}) }])) };
    const notionReq = async (_token, path, method, body) => {
      requests.push({ path, method, body });
      if (path === `/databases/${COMPANY_KR_DATABASE}`) {
        if (method === 'PATCH') for (const [key, value] of Object.entries(body.properties)) schema.properties[key] = { type: Object.keys(value)[0], ...value };
        return structuredClone(schema);
      }
      if (path.endsWith('/query')) return { results: structuredClone([...remote.values()].filter(p => !p.archived && !p.in_trash)), has_more: false };
      const id = path.split('/').pop(), page = remote.get(id) || goals.get(id);
      if (!page) throw new Error('来源404');
      if (method === 'PATCH') Object.assign(page.properties, body.properties);
      return structuredClone(page);
    };
    const app = express(); app.use(express.json()); app.use('/api/brain/okr', createCompanyKrRouter({ pool: scoped, token: 'fake', notionReq }));
    const project = () => runCompanyKrProjection(scoped, { token: 'fake', notionReq, now: projectionTime += 300001 });
    const list = async () => (await request(app).get('/api/brain/okr/company-key-results')).body.items;
    try {
      await client.query('BEGIN');
      await client.query("DELETE FROM key_results WHERE metadata->>'metric_mode'='company_formula_v1'");
      await client.query("DELETE FROM objectives WHERE metadata->>'source_system'='notion-company-okr'");
      await client.query("DELETE FROM notion_projection_map WHERE notion_db_id=$1 AND brain_table='key_results'", [COMPANY_KR_DATABASE]);
      const taskId = randomUUID();
      await client.query("INSERT INTO tasks(id,title,task_type,status,executor_kind,result) VALUES($1,'公司KR分析PG验收','qiumi_task','in_progress','openclaw-agent','{}')", [taskId]);
      const imported = await request(app).post('/api/brain/okr/company-key-results/import').send({ actor: 'test', task_id: taskId });
      expect(imported.status).toBe(200); expect(imported.body.created).toBe(8);
      expect((await request(app).post('/api/brain/okr/company-key-results/import').send({ actor: 'test', task_id: taskId })).body.created).toBe(0);
      const kr = (await list()).find(k => k.source_page_id === COMPANY_KR_CATALOG[0].page_id);
      expect(kr).toMatchObject({ current_value: '1.234', progress_ratio: 0.247, advice: null, observation: null });
      const observation = { task_id: taskId, actor: 'opc-kr-current', source_page_id: kr.source_page_id, unit: kr.unit, current_value: '2.345', observed_at: '2026-10-01T01:00:00Z', expected_updated_at: kr.updated_at, evidence: [{ fact: '独立实测2.345', source: 'fixture:counter' }], idempotency_key: 'pg-observe' };
      const observed = await request(app).post(`/api/brain/okr/key-results/${kr.id}/observations`).send(observation);
      expect(observed.status).toBe(200);
      expect(observed.body.item).toMatchObject({ current_value: '1.234', formal_revision: kr.formal_revision, observation: { current_value: '2.345' } });
      let saved = (await client.query('SELECT * FROM key_results WHERE id=$1', [kr.id])).rows[0];
      expect(saved.current_value).toBe('1.23'); expect(saved.progress).toBe(25);
      expect((await request(app).post(`/api/brain/okr/key-results/${kr.id}/observations`).send(observation)).body.duplicate).toBe(true);
      const advice = { task_id: taskId, actor: 'brain-openclaw-reaper', source_page_id: kr.source_page_id, formal_revision: kr.formal_revision, suggested_current: '2.345', suggested_target: null, reason: '当前有采集证据，目标缺充分证据', evidence: observation.evidence, analyzed_at: '2026-10-01T02:00:00Z', idempotency_key: `${taskId}:${kr.id}` };
      await expect(saveCompanyAdvice(scoped, kr.id, advice)).rejects.toMatchObject({ status: 403 });
      await client.query('UPDATE tasks SET payload=$2::jsonb WHERE id=$1', [taskId, JSON.stringify({ company_kr_analysis: { version: 1, snapshot_id: 'real-pg-snapshot', items: [{ id: kr.id, source_page_id: kr.source_page_id, formal_revision: kr.formal_revision, evidence: observation.evidence, observation: { current_value: '2.345', evidence: observation.evidence } }] } })]);
      expect(await saveCompanyAdvice(scoped, kr.id, advice)).toMatchObject({ success: true, duplicate: false });
      const receipt = (await client.query('SELECT result FROM tasks WHERE id=$1', [taskId])).rows[0].result;
      expect(receipt.company_kr_advice).toHaveLength(1); expect(receipt.metric_observations.some(e => e.idempotency_key === 'pg-observe')).toBe(true);
      expect(await project()).toMatchObject({ expected: 8, matched: 8, changed_ids: [] });
      const source = remote.get(kr.source_page_id);
      expect(source.properties.Current.number).toBe(1.234);
      expect(source.properties['AI建议当前'].number).toBe(2.345);
      expect(source.properties['AI观测值'].number).toBe(2.345);
      expect(source.properties['AI建议'].rich_text[0].text.content).toContain('fixture:counter');
      expect(requests.filter(r => r.method === 'PATCH' && r.path.startsWith('/pages')).every(r => Object.keys(r.body.properties).every(k => k.startsWith('AI')))).toBe(true);
      requests.length = 0;
      expect((await project()).changed_ids).toEqual([]); expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(0);
      // 人类正式更新，旧机器pending保留证据且不阻断回读。
      await client.query("UPDATE key_results SET metadata=jsonb_set(metadata,'{company_projection_pending}','{\"attempt_id\":\"legacy\",\"value\":\"8\"}') WHERE id=$1", [kr.id]);
      source.properties.Current.number = 3.456; source.properties.Target.number = 10;
      expect((await project()).changed_ids).toEqual([kr.id]);
      saved = (await client.query('SELECT * FROM key_results WHERE id=$1', [kr.id])).rows[0];
      expect(saved.metadata.company_metric).toMatchObject({ current: '3.456', target: '10' });
      expect(saved.metadata.company_projection_pending).toBeUndefined();
      expect(saved.metadata.last_observation.current_value).toBe('2.345');
      expect(source.properties['AI分析状态'].rich_text[0].text.content).toContain('过期');
      await expect(saveCompanyAdvice(scoped, kr.id, { ...advice, idempotency_key: 'stale-new' })).rejects.toMatchObject({ status: 409 });
      const history = (await client.query('SELECT history FROM notion_ingest_receipts WHERE notion_page_id=$1', [`${kr.source_page_id}#company-formal`])).rows[0].history;
      expect(history.some(e => e.superseded_machine_attempt?.attempt_id === 'legacy')).toBe(true);
      // 动态第9条、新Goal、Area/title映射，空白第10行独立反馈。
      const newGoal = randomUUID(), newPage = randomUUID(), emptyPage = randomUUID(), area = randomUUID();
      goals.set(newGoal, { id: newGoal, parent: { database_id: COMPANY_GOAL_DATABASE }, properties: { Name: title('新目标'), Area: { relation: [{ id: area }] } } });
      remote.set(newPage, { ...structuredClone(source), id: newPage, properties: { ...structuredClone(source.properties), Name: title('新增客户KR'), Goal: { relation: [{ id: newGoal }] }, Area: { relation: [{ id: area }] }, Unit: { rich_text: [{ text: { content: '客户数' } }] } } });
      remote.set(emptyPage, { ...structuredClone(source), id: emptyPage, properties: { ...structuredClone(source.properties), Goal: { relation: [] } } });
      const ninth = await project(); expect(ninth.expected).toBe(9); expect(ninth.errors.some(e => e.page_id === emptyPage)).toBe(true);
      const added = (await list()).find(k => k.source_page_id === newPage);
      expect(added).toMatchObject({ unit: '客户数', source_goal_id: newGoal, source_area_ids: [area] });
      source.properties.Name = title('已调整KR标题'); source.properties.Goal = { relation: [{ id: newGoal }] }; source.properties.Area = { relation: [{ id: area }] }; source.properties.Status.status.name = 'Paused';
      expect((await project()).changed_ids).toContain(kr.id);
      expect((await list()).find(k => k.id === kr.id)).toMatchObject({ title: '已调整KR标题', active: false, source_goal_id: newGoal, source_area_ids: [area] });
      expect(source.properties['AI分析状态'].rich_text[0].text.content).toContain('停止分析');
      const addedPage = remote.get(newPage); addedPage.properties.Goal.relation = [];
      expect((await project()).changed_ids).toContain(added.id);
      expect((await list()).find(k => k.id === added.id)).toMatchObject({ active: false, sync_error: { reason: expect.stringContaining('Goal') } });
      expect((await project()).changed_ids).toEqual([]);
      addedPage.properties.Goal.relation = [{ id: newGoal }];
      expect((await project()).changed_ids).toContain(added.id);
      expect((await list()).find(k => k.id === added.id)).toMatchObject({ active: true, sync_error: null });
      remote.get(newPage).archived = true;
      expect((await project()).changed_ids).toContain(added.id);
      expect((await list()).find(k => k.id === added.id).active).toBe(false);
      // 完成任务后的原收据重试只读；不创建新收据。
      await client.query("UPDATE tasks SET status='completed' WHERE id=$1", [taskId]);
      expect((await saveCompanyAdvice(scoped, kr.id, { ...advice, analyzed_at: '2026-10-01T05:00:00Z' })).duplicate).toBe(true);
      expect((await client.query('SELECT result FROM tasks WHERE id=$1', [taskId])).rows[0].result.company_kr_advice).toHaveLength(1);
      await expect(assertCompanyPatch(scoped, kr.id, { metadata: { company_advice: null } })).rejects.toThrow('保留');
      expect((await client.query(`UPDATE key_results SET current_value=99 WHERE id=$1 AND ${COMPANY_KR_SQL_GUARD}`, [kr.id])).rowCount).toBe(0);
    } finally { await client.query('ROLLBACK'); client.release(); await pool.end(); }
  }, 30000);
});

describe('KR配置事务真实 PostgreSQL', () => {
  it('规范化、唯一active、归属拒绝与schema失败均保留既有登记，测试结束恢复原库', async () => {
    const pool = new pg.Pool({ host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME || 'cecelia_test', user: process.env.DB_USER || 'cecelia', password: process.env.DB_PASSWORD });
    const oldId = randomUUID(), newId = randomUUID(), foreignId = randomUUID(), legacyId = randomUUID(), concurrentId = randomUUID();
    const ids = [oldId, newId, foreignId, legacyId, legacyId.replaceAll('-', ''), concurrentId];
    const before = (await pool.query("SELECT notion_db_id,status FROM notion_projection_map WHERE brain_table='key_results' AND vessel=$1", [KR_PROJECTION_VESSEL])).rows;
    const notionReq = async () => ({ title: [{ plain_text: 'Brain Key Results' }], properties: Object.fromEntries(Object.entries(KR_DB_PROPERTIES).map(([name, spec]) => [name, { type: Object.keys(spec)[0] }])) });
    const deps = { token: 'fake', notionReq };
    try {
      await pool.query(`INSERT INTO notion_projection_map(notion_db_id,title,face,brain_table,direction,vessel,status)
        VALUES ($1,'旧独立库','mirror','key_results','push',$2,'active'),
               ($3,'已有任务入口','inlet','tasks','ingest','task-ingest','active'),
               ($4,'旧格式独立库','mirror','key_results','push',$2,'dormant')`, [oldId, KR_PROJECTION_VESSEL, foreignId, legacyId.replaceAll('-', '')]);
      expect(await configureKrProjection(pool, newId.replaceAll('-', '').toUpperCase(), deps)).toMatchObject({ database_id: newId, status: 'active' });
      expect((await pool.query('SELECT status FROM notion_projection_map WHERE notion_db_id=$1', [oldId])).rows[0].status).toBe('dormant');
      const active = () => pool.query("SELECT notion_db_id FROM notion_projection_map WHERE brain_table='key_results' AND vessel=$1 AND status='active'", [KR_PROJECTION_VESSEL]);
      expect((await active()).rows).toEqual([{ notion_db_id: newId }]);
      await expect(configureKrProjection(pool, foreignId, deps)).rejects.toThrow('归属');
      expect((await active()).rows).toEqual([{ notion_db_id: newId }]);
      await expect(configureKrProjection(pool, oldId, { token: 'fake', notionReq: async () => ({ title: [{ plain_text: '错误库' }], properties: {} }) })).rejects.toThrow('独立');
      expect((await active()).rows).toEqual([{ notion_db_id: newId }]);
      await configureKrProjection(pool, legacyId, deps);
      expect((await pool.query("SELECT notion_db_id FROM notion_projection_map WHERE lower(replace(notion_db_id,'-',''))=$1", [legacyId.replaceAll('-', '')])).rows).toEqual([{ notion_db_id: legacyId }]);
      await Promise.all([configureKrProjection(pool, newId, deps), configureKrProjection(pool, concurrentId, deps)]);
      expect((await active()).rows).toHaveLength(1);
      expect((await pool.query('SELECT brain_table,face,vessel,status FROM notion_projection_map WHERE notion_db_id=$1', [foreignId])).rows[0]).toMatchObject({ brain_table: 'tasks', face: 'inlet', vessel: 'task-ingest', status: 'active' });
    } finally {
      await pool.query('DELETE FROM notion_projection_map WHERE notion_db_id=ANY($1::text[])', [ids]);
      for (const r of before) await pool.query('UPDATE notion_projection_map SET status=$1 WHERE notion_db_id=$2', [r.status, r.notion_db_id]);
      await pool.end();
    }
  });
});
