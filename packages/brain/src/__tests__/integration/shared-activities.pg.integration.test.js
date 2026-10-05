import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import pg from 'pg';
import express from 'express';
import request from 'supertest';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { syncActivityContracts } from '../../activity-contract-sync.js';
import { contractsFixture, KEYS } from '../fixtures/shared-activity-contracts.js';
import { likeSource } from '../fixtures/minimum-definition-schema.js';
vi.mock('../../alerting.js', () => ({ raise: vi.fn() }));
const holder = vi.hoisted(() => ({ db: null }));
vi.mock('../../db.js', () => ({ default: { query: (...args) => holder.db.query(...args), connect: (...args) => holder.db.connect(...args) } }));
import routes from '../../routes/workflows.js';
import { companyKrSpec as spec, registerCompanyKrWorkflow } from '../../lib/company-kr-registration.js';
const migration = new URL('../../../migrations/511_shared_activity_refs.sql', import.meta.url);
let client, schema, db, keyword, benchmark, capBenchmark, legacy;
beforeEach(async () => {
  if (!(DB_DEFAULTS.database==='cecelia_scratch' || (process.env.CI==='true' && DB_DEFAULTS.database==='cecelia_test'))) throw new Error('仅允许隔离测试数据库');
  client = new pg.Client(DB_DEFAULTS); await client.connect();
  expect((await client.query('SELECT current_database() AS name')).rows[0].name).toBe(DB_DEFAULTS.database);
  schema = `shared_activity_${randomUUID().replaceAll('-', '')}`;
  await client.query(`CREATE SCHEMA ${schema}`);
  for (const table of ['areas','enablers','enabler_calls','schema_version','journeys','workflows','journey_steps','steps','spans','ops_agents','ops_workflows','tasks','task_runs'])
    await client.query(`CREATE TABLE ${schema}.${table} (LIKE public.${likeSource(table)} INCLUDING ALL)`);
  await client.query(`SET search_path TO ${schema}`);
  db = { query: client.query.bind(client), connect: async () => ({ query: client.query.bind(client), release() {} }) }; holder.db = db;
  const parent = randomUUID(), capKeyword = randomUUID(); capBenchmark = randomUUID();
  await client.query(`INSERT INTO journeys(id,name,parent_journey_id) VALUES($1,'价值流',NULL),($2,'关键词',$1),($3,'对标',$1)`, [parent,capKeyword,capBenchmark]);
  keyword = randomUUID(); benchmark = randomUUID();
  await client.query(`INSERT INTO workflows(id,capability_id,key,name,channel) VALUES($1,$3,'douyin_keyword_leadgen','关键词','douyin'),($2,$4,'douyin_benchmark_leadgen','对标','douyin')`, [keyword,benchmark,capKeyword,capBenchmark]);
  legacy = [];
  for (const [i,key] of KEYS.entries()) {
    const id = randomUUID(); legacy.push(id);
    await client.query(`INSERT INTO journey_steps(id,journey_id,name,step_number,capability_key,activity_key,workflow_id,status,backbone_version) VALUES($1,$2,$3::text,$4,'keyword_acquisition',$3::text,$5,'active','3.0')`, [id,parent,key,i+1,keyword]);
  }
});
afterEach(async () => {
  if (client) { await client.query('ROLLBACK'); await client.query('SET search_path TO public'); if (schema) await client.query(`DROP SCHEMA ${schema} CASCADE`); await client.end(); }
});
async function migrate() {
  expect(existsSync(migration), '共享关系迁移必须存在').toBe(true);
  await client.query(readFileSync(migration,'utf8'));
  await client.query(readFileSync(new URL('../../../migrations/513_definition_versions.sql',import.meta.url),'utf8'));
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
    const list = await request(app).get('/api/brain/workflows'); expect(list.status,list.body.error).toBe(200);
    expect(list.body.workflows.map(w=>w.activity_count)).toEqual([8,8]);
    const detail = await request(app).get(`/api/brain/workflows/${benchmark}`); expect(detail.status).toBe(200);
    expect(detail.body.workflow.activities.map(x=>x.slot_key)).toEqual(KEYS);
    expect(detail.body.workflow.activities[0]).toMatchObject({activity_id:legacy[0],canonical_id:legacy[0],source_ref:'keyword_acquisition.preflight'});
    expect(detail.body.workflow.activities[0].usage.workflow_id).toBe(benchmark);
    expect(detail.body.workflow.activities[0].legacy_workflow_id).toBe(keyword);
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
  it('KR登记补全共享关系，五活动八步骤及既有ID和运行事实保持',async()=>{
    await migrate();
    await client.query(`INSERT INTO journeys(id,name,parent_journey_id,capability_code) VALUES($1,'管家 · G5 算力与基础设施调度',$2,'G5')`,[spec.capability_id,randomUUID()]);
    await client.query(`INSERT INTO ops_agents(id,source,host_alias,name) VALUES(1,'openclaw','mmv',$1)`,[spec.agent]);
    await client.query(`INSERT INTO ops_workflows(id,source,wf_id,name) VALUES(1,'scheduler',$1,$1)`,[spec.runtime]);
    const first=await registerCompanyKrWorkflow(db);
    const ids=(await client.query('SELECT id FROM journey_steps WHERE workflow_id=$1 ORDER BY step_number',[first.workflow_id])).rows;
    await registerCompanyKrWorkflow(db);
    expect((await client.query('SELECT id FROM journey_steps WHERE workflow_id=$1 ORDER BY step_number',[first.workflow_id])).rows).toEqual(ids);
    const app=express(); app.use('/api/brain',routes);
    const detail=await request(app).get(`/api/brain/workflows/${first.workflow_id}`);
    expect(detail.body.workflow.activities).toHaveLength(5);
    expect(detail.body.workflow.activities.flatMap(a=>a.steps)).toHaveLength(8);
  });
  it('消费者HTTP反查共享归属；独有活动metrics指向规范价值流',async()=>{
    await migrate(); await syncActivityContracts(db,contractsFixture());
    const app=express(); app.use('/api/brain',routes);
    const result=await request(app).get(`/api/brain/activities/${legacy[0]}/consumers`);
    expect(result.status).toBe(200); expect(result.body.consumers.map(c=>c.workflow_id).sort()).toEqual([keyword,benchmark].sort());
    const activity=(await client.query("SELECT id FROM journey_steps WHERE capability_key='benchmark_link_acquisition'")).rows[0].id;
    await client.query(`INSERT INTO spans(run_id,activity_id,workflow_id,started_at,executor_kind) VALUES('own',$1,$2,now(),'code')`,[activity,benchmark]);
    const expected=(await client.query('SELECT parent_journey_id FROM journeys WHERE id=$1',[capBenchmark])).rows[0].parent_journey_id;
    expect((await client.query('SELECT value_stream_id FROM activity_flow_metrics WHERE activity_id=$1',[activity])).rows[0].value_stream_id).toBe(expected);
  });

  it('部分旧步骤不遮盖契约；共享组件包含Activity及Step调用',async()=>{
    await migrate(); await syncActivityContracts(db,contractsFixture());
    const step=randomUUID(), enabler=randomUUID();
    await client.query(`INSERT INTO steps(id,activity_id,step_order,key,activity_key,readback) VALUES($1,$2,1,'preflight_step','preflight','{"name":"旧名"}')`,[step,legacy[0]]);
    await client.query(`UPDATE journey_steps SET contract=jsonb_set(contract,'{steps}',contract->'steps'||'[{"key":"second","order":2,"name":"新增步骤"}]'::jsonb) WHERE id=$1`,[legacy[0]]);
    await client.query(`INSERT INTO enablers(id,key,name,kind,shelf) VALUES($1,'shared','共享组件','code','generic_action')`,[enabler]);
    await client.query(`INSERT INTO enabler_calls(caller_type,caller_id,enabler_id) VALUES('activity',$1,$3),('step',$2,$3)`,[legacy[0],step,enabler]);
    const app=express();app.use('/api/brain',routes);
    const result=await request(app).get(`/api/brain/workflows/${benchmark}`), activity=result.body.workflow.activities[0];
    expect(activity.steps).toHaveLength(2);expect(activity.steps[0].id).toBe(step);
    expect(activity.shared_components.map(c=>c.caller_type).sort()).toEqual(['activity','step']);
  });

  it('去共享、活动移除与恢复保留ID；顺序交换和迁移重放保持关系',async()=>{
    await migrate();const fixture=contractsFixture();await syncActivityContracts(db,fixture);
    fixture.docs.benchmark_link_acquisition.activities[0]={...fixture.docs.keyword_acquisition.activities[0],name:'对标独立预检'};
    fixture.docs.keyword_acquisition.activities[0].order=2;
    fixture.docs.keyword_acquisition.activities[1].order=1;
    fixture.refresh();await syncActivityContracts(db,fixture);
    const refs=(await client.query('SELECT * FROM workflow_activity_refs WHERE active ORDER BY workflow_id,sequence_no')).rows;
    expect(refs.filter(r=>r.activity_id===legacy[0])).toHaveLength(1);
    expect(refs.find(r=>r.workflow_id===keyword&&r.slot_key==='preflight').sequence_no).toBe(2);
    const before=await snapshot();await migrate();expect(await snapshot()).toEqual(before);
    const own=fixture.docs.benchmark_link_acquisition.activities[1];
    const identity=(await client.query("SELECT id FROM journey_steps WHERE capability_key='benchmark_link_acquisition' AND activity_key='discovery'")).rows[0].id;
    fixture.docs.benchmark_link_acquisition.activities.splice(1,1);fixture.refresh();await syncActivityContracts(db,fixture);
    expect((await client.query('SELECT active FROM workflow_activity_refs WHERE workflow_id=$1 AND slot_key=$2',[benchmark,'discovery'])).rows[0].active).toBe(false);
    expect((await client.query('SELECT status FROM journey_steps WHERE id=$1',[identity])).rows[0].status).toBe('deprecated');
    fixture.docs.benchmark_link_acquisition.activities.splice(1,0,own);fixture.refresh();await syncActivityContracts(db,fixture);
    expect((await client.query('SELECT activity_id FROM workflow_activity_refs WHERE workflow_id=$1 AND slot_key=$2',[benchmark,'discovery'])).rows[0].activity_id).toBe(identity);
    const restored=await snapshot();await syncActivityContracts(db,fixture);expect(await snapshot()).toEqual(restored);
  });
  it('同顺序新定义可替代已退役定义，不改历史顺序或ID',async()=>{
    await migrate();const f=contractsFixture();await syncActivityContracts(db,f);
    const before=(await client.query("SELECT id,step_number FROM journey_steps WHERE capability_key='benchmark_link_acquisition'")).rows[0];
    f.docs.benchmark_link_acquisition.activities[1].key='discover_v2';f.refresh();
    await syncActivityContracts(db,f);
    expect((await client.query('SELECT id,step_number,status FROM journey_steps WHERE id=$1',[before.id])).rows[0]).toEqual({...before,status:'deprecated'});
    expect((await client.query("SELECT sequence_no FROM workflow_activity_refs WHERE workflow_id=$1 AND slot_key='discover_v2'",[benchmark])).rows[0].sequence_no).toBe(2);
  });

  it('空活动的已登记workflow仍同步，活动零消费者与不存在明确区分',async()=>{
    await migrate();const f=contractsFixture();await syncActivityContracts(db,f);
    f.docs.keyword_acquisition.activities=[];f.docs.benchmark_link_acquisition.activities=[];f.refresh();await syncActivityContracts(db,f);
    expect((await client.query('SELECT count(*)::int n FROM workflow_activity_refs WHERE active')).rows[0].n).toBe(0);
    const app=express();app.use('/api/brain',routes);
    expect((await request(app).get(`/api/brain/activities/${legacy[0]}/consumers`)).body.consumers).toEqual([]);
    expect((await request(app).get(`/api/brain/activities/${randomUUID()}/consumers`)).status).toBe(404);
  });

  it('并发较慢的旧HEAD不得覆盖先完成的新HEAD，包括首次同步',async()=>{
    await migrate();const old=contractsFixture(),fresh=contractsFixture();
    fresh.docs.keyword_acquisition.activities[0].name='新版本预检';fresh.refresh();
    const freshFetch=fresh.fetchFn;fresh.fetchFn=async url=>url.includes('/commits/main')?{ok:true,text:async()=> 'b'.repeat(40)}:freshFetch(url);
    let unblock,started;const blocked=new Promise(resolve=>{unblock=resolve;});const ready=new Promise(resolve=>{started=resolve;});
    const oldFetch=old.fetchFn;old.fetchFn=async url=>{if(url.includes('contracts/benchmark_link_acquisition.yaml')){started();await blocked;}return oldFetch(url);};
    const pending=syncActivityContracts(db,old);await ready;
    try { await syncActivityContracts(db,fresh); } finally { unblock(); }
    await expect(pending).rejects.toThrow('同步快照已变化');
    expect((await client.query('SELECT name FROM journey_steps WHERE id=$1',[legacy[0]])).rows[0].name).toBe('新版本预检');
    expect((await client.query('SELECT DISTINCT source_commit FROM workflow_activity_refs WHERE active')).rows).toEqual([{source_commit:'b'.repeat(40)}]);
  });
  it('加载期间登记映射变化必须拒绝旧计划，零部分写入',async()=>{
    await migrate();const before=await snapshot(),f=contractsFixture(),fetch=f.fetchFn;
    let changed=false;f.fetchFn=async url=>{if(!changed&&url.includes('contracts/keyword_acquisition.yaml')){changed=true;await client.query("UPDATE workflows SET source_workflow='new-source' WHERE id=$1",[keyword]);}return fetch(url);};
    await expect(syncActivityContracts(db,f)).rejects.toThrow('同步快照已变化');expect(await snapshot()).toEqual(before);
  });
  it('定义拥有者工作流退休后，活跃消费者仍同步并保留规范身份',async()=>{
    await migrate();const f=contractsFixture();await syncActivityContracts(db,f);
    await client.query("UPDATE workflows SET status='retired' WHERE id=$1",[keyword]);
    f.docs.keyword_acquisition.activities[0].name='共享预检新版';f.refresh();
    await syncActivityContracts(db,f);
    expect((await client.query('SELECT name FROM journey_steps WHERE id=$1',[legacy[0]])).rows[0].name).toBe('共享预检新版');
    expect((await client.query('SELECT workflow_id,activity_id FROM workflow_activity_refs WHERE slot_key=$1 AND active',['preflight'])).rows).toEqual([{workflow_id:benchmark,activity_id:legacy[0]}]);
  });

});
