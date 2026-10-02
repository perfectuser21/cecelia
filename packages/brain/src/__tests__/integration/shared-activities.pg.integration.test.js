import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import pg from 'pg';
import express from 'express';
import request from 'supertest';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { syncActivityContracts } from '../../activity-contract-sync.js';
import { contractsFixture, KEYS } from '../fixtures/shared-activity-contracts.js';
vi.mock('../../alerting.js', () => ({ raise: vi.fn() }));
const holder = vi.hoisted(() => ({ db: null }));
vi.mock('../../db.js', () => ({ default: { query: (...args) => holder.db.query(...args), connect: (...args) => holder.db.connect(...args) } }));
import routes from '../../routes/workflows.js';
const migration = new URL('../../../migrations/511_shared_activity_refs.sql', import.meta.url);
let client, schema, db, keyword, benchmark, capBenchmark, legacy;
beforeEach(async () => {
  if (!['cecelia_scratch', 'cecelia_test'].includes(DB_DEFAULTS.database)) throw new Error('仅允许隔离测试数据库');
  client = new pg.Client(DB_DEFAULTS); await client.connect();
  schema = `shared_activity_${randomUUID().replaceAll('-', '')}`;
  await client.query(`CREATE SCHEMA ${schema}`);
  for (const table of ['schema_version','journeys','workflows','journey_steps','steps','spans','ops_agents','ops_workflows','tasks','task_runs'])
    await client.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
  await client.query(`SET search_path TO ${schema}`);
  db = { query: client.query.bind(client), connect: async () => ({ query: client.query.bind(client), release() {} }) }; holder.db = db;
  const parent = randomUUID(), capKeyword = randomUUID(); capBenchmark = randomUUID();
  await client.query(`INSERT INTO journeys(id,name,parent_journey_id) VALUES($1,'价值流',NULL),($2,'关键词',$1),($3,'对标',$1)`, [parent,capKeyword,capBenchmark]);
  keyword = randomUUID(); benchmark = randomUUID();
  await client.query(`INSERT INTO workflows(id,capability_id,key,name,channel) VALUES($1,$3,'douyin_keyword_leadgen','关键词','douyin'),($2,$4,'douyin_benchmark_leadgen','对标','douyin')`, [keyword,benchmark,capKeyword,capBenchmark]);
  legacy = [];
  for (const [i,key] of KEYS.entries()) {
    const id = randomUUID(); legacy.push(id);
    await client.query(`INSERT INTO journey_steps(id,journey_id,name,step_number,capability_key,activity_key,workflow_id,status,backbone_version) VALUES($1,$2,$3,$4,'keyword_acquisition',$3,$5,'active','3.0')`, [id,parent,key,i+1,keyword]);
  }
});
afterEach(async () => {
  if (client) { await client.query('ROLLBACK'); await client.query('SET search_path TO public'); if (schema) await client.query(`DROP SCHEMA ${schema} CASCADE`); await client.end(); }
});
async function migrate() {
  expect(existsSync(migration), '共享关系迁移必须存在').toBe(true);
  await client.query(readFileSync(migration,'utf8'));
}
async function snapshot() {
  return (await client.query(`SELECT jsonb_build_object('activities',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM journey_steps a),
    'refs',(SELECT jsonb_agg(to_jsonb(r) ORDER BY workflow_id,slot_key) FROM workflow_activity_refs r)) AS state`)).rows[0].state;
}
describe('共享活动真实数据库合同', () => {
  it('迁移两次幂等，8+8引用共享7个UUID、只新增对标发现，重复同步保持历史与数量', async () => {
    await migrate(); const first = await snapshot(); await migrate(); expect(await snapshot()).toEqual(first);
    await syncActivityContracts(db, contractsFixture());
    const rows = (await client.query('SELECT * FROM workflow_activity_refs WHERE active ORDER BY workflow_id,sequence_no')).rows;
    const kw = rows.filter(x=>x.workflow_id===keyword), bm = rows.filter(x=>x.workflow_id===benchmark);
    expect(kw).toHaveLength(8); expect(bm).toHaveLength(8);
    expect(kw.filter(x=>bm.some(y=>y.activity_id===x.activity_id))).toHaveLength(7);
    expect(kw.map(x=>x.activity_id)).toEqual(legacy);
    expect((await client.query(`SELECT journey_id FROM journey_steps WHERE capability_key='benchmark_link_acquisition'`)).rows).toEqual([{journey_id:capBenchmark}]);
    const state = await snapshot(); await syncActivityContracts(db,contractsFixture()); expect(await snapshot()).toEqual(state);
    const app = express(); app.use('/api/brain',routes);
    const list = await request(app).get('/api/brain/workflows'); expect(list.status).toBe(200);
    expect(list.body.workflows.map(w=>w.activity_count)).toEqual([8,8]);
    const detail = await request(app).get(`/api/brain/workflows/${benchmark}`); expect(detail.status).toBe(200);
    expect(detail.body.workflow.activities.map(x=>x.slot_key)).toEqual(KEYS);
    expect(detail.body.workflow.activities[0]).toMatchObject({activity_id:legacy[0],source_ref:'keyword_acquisition.preflight'});
    expect(detail.body.workflow.activities[0].steps).toHaveLength(1);
    expect(detail.body.workflow.activities[0].gaps).toHaveLength(1);
  });
  it.each(['fetch','digest','ref','unique'])('%s 失败不留下部分写入',async failure=>{
    await migrate(); const before=await snapshot(), fixture=contractsFixture();
    if(failure==='fetch') { const fetch=fixture.fetchFn; fixture.fetchFn=async url=>url.includes('benchmark_link')?{ok:false,status:502}:fetch(url); }
    if(failure==='digest') fixture.digest.capabilities.benchmark_link_acquisition.sha256='bad';
    if(failure==='ref') fixture.docs.benchmark_link_acquisition.activities[0].ref='keyword_acquisition.absent';
    if(failure==='unique') await client.query(`CREATE UNIQUE INDEX force_activity_conflict ON journey_steps ((1)) WHERE capability_key='benchmark_link_acquisition' OR activity_key='preflight'`);
    await expect(syncActivityContracts(db,fixture)).rejects.toThrow(); expect(await snapshot()).toEqual(before);
  });
  it('真实span工作流优先，多归属缺失保持未知，Activity与Step段不重复累计',async()=>{
    await migrate(); await syncActivityContracts(db,contractsFixture());
    const step=randomUUID(); await client.query(`INSERT INTO steps(id,activity_id,step_order,key,activity_key) VALUES($1,$2,1,'span-step','preflight')`,[step,legacy[0]]);
    await client.query(`INSERT INTO spans(run_id,workflow_id,activity_id,step_id,started_at,ended_at,executor_kind,tokens_in) VALUES
      ('r1',$1,$2,NULL,now(),now()+interval '1 second','code',10),
      ('r1',$1,$2,$3,now(),now()+interval '0.5 second','code',10),
      ('r2',NULL,$2,NULL,now(),now()+interval '1 second','code',20)`,[benchmark,legacy[0],step]);
    const rows=(await client.query('SELECT workflow_id,span_count,tokens_total FROM activity_flow_metrics')).rows;
    expect(rows).toContainEqual({workflow_id:benchmark,span_count:1,tokens_total:'10'});
    expect(rows).toContainEqual({workflow_id:null,span_count:1,tokens_total:'20'});
  });
});
