import { describe, it, expect } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { runNotionKrProjection, KR_DB_PROPERTIES, configureKrProjection, KR_PROJECTION_VESSEL } from '../../projection/key-results.js';
import express from 'express';
import request from 'supertest';
import { createCompanyKrRouter } from '../../routes/company-key-results.js';
import { COMPANY_GOALS, COMPANY_KR_CATALOG, COMPANY_KR_DATABASE, COMPANY_FORMULA, COMPANY_KR_SQL_GUARD, assertCompanyPatch } from '../../lib/company-kr-metrics.js';
import { runCompanyKrProjection, COMPANY_KR_VESSEL } from '../../projection/company-key-results.js';
import { recalculateKrProgress } from '../../lib/kr-recalculate-progress.js';
import { buildNotionKrProperties } from '../../projection/key-results.js';
import { writeProgressToKR } from '../../kr3-progress-calculator.js';
import { answerQuestionForGoal } from '../../okr-tick.js';
import { observeCompanyKr } from '../../lib/company-kr-observations.js';

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
  it('8+3幂等导入、精度观察证据账、人Target与Current列投影真实产出，最后回滚', async () => {
    const pool = new pg.Pool({ host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 5432), database: process.env.DB_NAME || 'cecelia_test', user: process.env.DB_USER || 'cecelia', password: process.env.DB_PASSWORD });
    const client = await pool.connect(), taskId = randomUUID();
    const requests = [], remote = new Map();
    let serial = 0;
    // 模块自己的事务映射为savepoint，使真实事务产出可查且完全回滚。
    const scoped = { query: (...args) => client.query(...args), connect: async () => {
      const savepoint = `company_${++serial}`;
      return { query: (sql, args) => client.query(sql === 'BEGIN' ? `SAVEPOINT ${savepoint}` : sql === 'COMMIT' ? `RELEASE SAVEPOINT ${savepoint}` : sql === 'ROLLBACK' ? `ROLLBACK TO SAVEPOINT ${savepoint}` : sql, args), release() {} };
    } };
    const name = title => ({ type: 'title', title: [{ plain_text: title }] });
    for (const [i, kr] of COMPANY_KR_CATALOG.entries()) remote.set(kr.page_id, { id: kr.page_id, parent: { database_id: COMPANY_KR_DATABASE }, last_edited_time: '2026-09-14T15:05:00Z', last_edited_by: { id: 'source-user' }, properties: { Name: name(kr.title), Goal: { relation: [{ id: kr.goal_id }] }, Area: { relation: [] }, Current: { number: i === 0 ? 1.234 : 0 }, Start: { number: 0 }, Target: { number: 5 }, Status: { status: { name: 'Open' } } } });
    const notionReq = async (_token, path, method, body) => {
      requests.push({ path, method, body });
      if (path === `/databases/${COMPANY_KR_DATABASE}`) return { properties: Object.fromEntries(Object.entries({ Name: 'title', Current: 'number', Target: 'number', Start: 'number', Progress: 'formula', Goal: 'relation', Area: 'relation', Status: 'status' }).map(([k, type]) => [k, { type, ...(k === 'Progress' ? { formula: { expression: COMPANY_FORMULA } } : {}) }])) };
      if (path.endsWith('/query')) return { results: [...remote.values()], has_more: false };
      const id = path.split('/').pop();
      if (remote.has(id) && method === 'GET') return remote.get(id);
      if (remote.has(id) && method === 'PATCH') { Object.assign(remote.get(id).properties, body.properties); return remote.get(id); }
      const goal = COMPANY_GOALS.find(g => g.page_id === id);
      if (goal) return { id, properties: { Name: name(goal.title), Area: { relation: [] }, Status: { status: { name: 'Not Started' } } } };
      throw new Error(`未知Notion测试请求:${path}`);
    };
    const app = express(); app.use(express.json()); app.use('/api/brain/okr', createCompanyKrRouter({ pool: scoped, token: 'fake', notionReq }));
    try {
      await client.query('BEGIN');
      await client.query("DELETE FROM key_results WHERE metadata->>'metric_mode'='company_formula_v1'");
      await client.query("DELETE FROM objectives WHERE metadata->>'source_system'='notion-company-okr'");
      await client.query("DELETE FROM notion_projection_map WHERE notion_db_id=$1 AND brain_table='key_results'", [COMPANY_KR_DATABASE]);
      await client.query("INSERT INTO tasks(id,title,status,task_type,result) VALUES($1,'经营KR真库测试','in_progress','data','{}')", [taskId]);
      const imported = await request(app).post('/api/brain/okr/company-key-results/import').send({ actor: 'integration-test', task_id: taskId });
      expect(imported.status).toBe(200); expect(imported.body).toMatchObject({ created: 8, company_kr_count: 8 });
      const repeated = await request(app).post('/api/brain/okr/company-key-results/import').send({ actor: 'integration-test', task_id: taskId });
      expect(repeated.body.created).toBe(0);
      const list = (await request(app).get('/api/brain/okr/company-key-results')).body.items;
      expect(list).toHaveLength(8);
      expect(list.every(r => r.source_area_ids.length === 0 && r.validation_state === 'unverified')).toBe(true);
      const objectives = await client.query("SELECT area_id,vision_id FROM objectives WHERE metadata->>'source_system'='notion-company-okr'");
      expect(objectives.rows).toHaveLength(3); expect(objectives.rows.every(r => r.area_id === null && r.vision_id === null)).toBe(true);
      let kr = list.find(r => r.source_page_id === COMPANY_KR_CATALOG[0].page_id);
      expect(kr.current_value).toBe('1.234'); expect(kr.progress_ratio).toBe(0.247);
      const body = { source_page_id: kr.source_page_id, unit: kr.unit, current_value: '2.345', actor: 'opc-kr-current', task_id: taskId, observed_at: '2026-10-01T00:00:00Z', idempotency_key: 'company-test-observation', expected_updated_at: kr.updated_at, evidence: [{ source: 'fixture:snapshot', fact: '原指标真实观测2.345，非项目完成率' }] };
      const observed = await request(app).post(`/api/brain/okr/key-results/${kr.id}/observations`).send(body);
      expect(observed.status).toBe(200); expect(observed.body.item.current_value).toBe('2.345');
      expect((await request(app).post(`/api/brain/okr/key-results/${kr.id}/observations`).send(body)).body.duplicate).toBe(true);
      expect((await request(app).post(`/api/brain/okr/key-results/${kr.id}/observations`).send({ ...body, idempotency_key: 'stale-old', current_value: 9 })).status).toBe(409);
      const task = (await client.query('SELECT result FROM tasks WHERE id=$1', [taskId])).rows[0];
      expect(task.result.metric_observations.filter(e => e.idempotency_key === body.idempotency_key)).toHaveLength(1);
      let saved = (await client.query('SELECT * FROM key_results WHERE id=$1', [kr.id])).rows[0];
      expect(saved.current_value).toBe('2.35'); expect(saved.metadata.company_metric.current).toBe('2.345');
      expect(buildNotionKrProperties(saved).Current.number).toBe(2.345);
      await expect(assertCompanyPatch(scoped, kr.id, { metadata: null })).rejects.toThrow('保留');
      await expect(assertCompanyPatch(scoped, kr.id, { current_value: 90 })).rejects.toThrow('保留');
      expect((await recalculateKrProgress(scoped, kr.id)).reason).toBe('company_metric');
      expect((await client.query(`UPDATE key_results SET current_value=99 WHERE id=$1 AND ${COMPANY_KR_SQL_GUARD}`, [kr.id])).rowCount).toBe(0);
      const source = remote.get(kr.source_page_id); source.properties.Target.number = 1.234; source.last_edited_by.id = 'bot-after-human-target'; source.last_edited_time = '2026-10-01T01:00:00Z';
      requests.length = 0;
      expect(await runCompanyKrProjection(scoped, { token: 'fake', notionReq })).toMatchObject({ expected: 8, remote: 8, matched: 8, patched: 1 });
      const writes = requests.filter(r => r.method === 'PATCH');
      expect(writes).toHaveLength(1); expect(Object.keys(writes[0].body.properties)).toEqual(['Current']);
      expect(source.properties.Target.number).toBe(1.234);
      saved = (await client.query('SELECT * FROM key_results WHERE id=$1', [kr.id])).rows[0];
      expect(saved.target_value).toBe('1.23'); expect(saved.metadata.company_metric.target).toBe('1.234'); expect(saved.metadata.company_metric.ratio).toBe(1.9);
      const inlet = await client.query('SELECT history FROM notion_ingest_receipts WHERE notion_page_id=$1', [`${kr.source_page_id}#company-target`]);
      expect(inlet.rows[0].history[0]).toMatchObject({ actor: 'notion-inlet', editor: 'bot-after-human-target', before: { target: '5' }, after: { target: '1.234' } });
      const registry = await client.query("SELECT vessel,face,direction FROM notion_projection_map WHERE notion_db_id=$1 AND brain_table='key_results'", [COMPANY_KR_DATABASE]);
      expect(registry.rows[0]).toMatchObject({ vessel: COMPANY_KR_VESSEL, face: 'inlet', direction: 'both' });
      const systemIds = Array.from({ length: 38 }, () => randomUUID());
      for (const id of systemIds) await client.query("INSERT INTO key_results(id,title,status,current_value,target_value,progress,metadata) VALUES($1,'系统KR fixture','active',50,100,50,'{\"progress_source\":\"projects_v1\"}')", [id]);
      const allIds = [...systemIds, ...imported.body.ids], mirrorDb = randomUUID();
      expect((await client.query('SELECT count(*)::integer AS count FROM key_results WHERE id=ANY($1::uuid[])', [allIds])).rows[0].count).toBe(46);
      await client.query("UPDATE notion_projection_map SET status='dormant' WHERE vessel='notion-kr-projection' AND brain_table='key_results'");
      await client.query("INSERT INTO notion_projection_map(notion_db_id,title,face,brain_table,direction,vessel,status) VALUES($1,'Brain Key Results','mirror','key_results','push','notion-kr-projection','active')", [mirrorDb]);
      const mirrors = new Map();
      const mirrorPool = { query: (sql, args) => client.query(sql.includes('FROM key_results kr') ? sql.replace('ORDER BY kr.updated_at, kr.id', `WHERE kr.id IN (${allIds.map(id => `'${id}'`).join(',')}) ORDER BY kr.updated_at, kr.id`) : sql, args) };
      const mirrorReq = async (_token, path, method, body) => {
        if (path === `/databases/${mirrorDb}`) return { title: [{ plain_text: 'Brain Key Results' }], properties: Object.fromEntries(Object.entries(KR_DB_PROPERTIES).map(([k, v]) => [k, { type: Object.keys(v)[0] }])) };
        if (path.endsWith('/query')) return { results: [] };
        if (path === '/pages' && method === 'POST') { const id = randomUUID(); mirrors.set(id, body); return { id }; }
        throw new Error(`未知镜子请求:${path}`);
      };
      expect(await runNotionKrProjection(mirrorPool, { token: 'fake', notionReq: mirrorReq })).toMatchObject({ created: 46, failed: 0 });
      expect(mirrors.size).toBe(46);
      const links = await client.query("SELECT count(*)::integer AS count FROM projection_links WHERE target='notion' AND entity_type='key_results' AND entity_id=ANY($1::uuid[])", [allIds]);
      expect(links.rows[0].count).toBe(46);
      const mirror = [...mirrors.values()].find(p => p.properties['Brain ID'].rich_text[0].text.content === kr.id);
      expect(mirror.properties).toMatchObject({ Current: { number: 2.345 }, Target: { number: 1.234 }, Progress: { number: 190 } });
      // 真人Current相对已投影基线变化：保留其值及证据状态，不盲覆写为机器值。
      source.properties.Current.number = 3.456;
      source.last_edited_by.id = 'human-current'; source.last_edited_time = '2026-10-01T02:00:00Z';
      requests.length = 0;
      expect(await runCompanyKrProjection(scoped, { token: 'fake', notionReq, now: Date.now() + 300001 })).toMatchObject({ patched: 0, matched: 8, claims: 1 });
      expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(0);
      saved = (await client.query('SELECT * FROM key_results WHERE id=$1', [kr.id])).rows[0];
      expect(saved.metadata).toMatchObject({ company_metric: { current: '3.456' }, validation_state: 'unverified', company_current_baseline: '3.456' });
      const claim = (await client.query('SELECT result FROM tasks WHERE id=$1', [taskId])).rows[0].result.metric_observations.find(e => e.kind === 'human_current_claim');
      expect(claim).toMatchObject({ editor: 'human-current', before: { current: '2.345' }, after: { current: '3.456' } });
      const companyBefore = (await client.query("SELECT id,progress FROM key_results WHERE metadata->>'metric_mode'='company_formula_v1' ORDER BY id")).rows;
      await writeProgressToKR(scoped, 99);
      expect((await client.query("SELECT id,progress FROM key_results WHERE metadata->>'metric_mode'='company_formula_v1' ORDER BY id")).rows).toEqual(companyBefore);
      // 同毫秒不同微秒必须拒绝旧版本；不能依赖JS Date的毫秒截断。
      await client.query("UPDATE key_results SET updated_at='2026-10-01T03:00:00.123001Z' WHERE id=$1", [kr.id]);
      const oldVersion = (await request(app).get('/api/brain/okr/company-key-results')).body.items.find(r => r.id === kr.id).updated_at;
      await client.query("UPDATE key_results SET updated_at='2026-10-01T03:00:00.123002Z' WHERE id=$1", [kr.id]);
      expect((await request(app).post(`/api/brain/okr/key-results/${kr.id}/observations`).send({ ...body, idempotency_key: 'microsecond-stale', expected_updated_at: oldVersion })).status).toBe(409);
      // 问题读取旧metadata后发生新观察，回答仅更新questions，不能吞掉指标/证据。
      await client.query("UPDATE key_results SET metadata=jsonb_set(metadata,'{pending_questions}','[{\"id\":\"question\"}]'::jsonb,true) WHERE id=$1", [kr.id]);
      const questionDb = { query: async (sql, args) => {
        const result = await client.query(sql, args);
        if (sql.includes('SELECT metadata')) {
          const fresh = (await request(app).get('/api/brain/okr/company-key-results')).body.items.find(r => r.id === kr.id);
          await observeCompanyKr(scoped, kr.id, { ...body, current_value: '4.567', observed_at: '2026-10-01T04:00:00Z', expected_updated_at: fresh.updated_at, idempotency_key: 'concurrent-question' });
        }
        return result;
      } };
      await answerQuestionForGoal(kr.id, 'question', '保留指标', questionDb);
      saved = (await client.query('SELECT * FROM key_results WHERE id=$1', [kr.id])).rows[0];
      expect(saved.metadata).toMatchObject({ metric_mode: 'company_formula_v1', company_metric: { current: '4.567' }, last_observation: { idempotency_key: 'concurrent-question' }, pending_questions: [{ id: 'question', answer: '保留指标', answered: true }] });
      // 基线缺失时无法判别来源，留账停该页，双方值都保留。
      await client.query("UPDATE key_results SET metadata=metadata-'company_current_baseline' WHERE id=$1", [kr.id]);
      requests.length = 0;
      await expect(runCompanyKrProjection(scoped, { token: 'fake', notionReq, now: Date.now() + 600002 })).rejects.toThrow('无基线冲突');
      expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(0);
      expect((await client.query('SELECT metadata FROM key_results WHERE id=$1', [kr.id])).rows[0].metadata.company_metric.current).toBe('4.567');
      expect((await client.query('SELECT result FROM tasks WHERE id=$1', [taskId])).rows[0].result.metric_observations.some(e => e.kind === 'current_conflict')).toBe(true);
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
