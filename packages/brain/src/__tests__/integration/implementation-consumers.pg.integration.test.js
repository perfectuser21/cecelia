import { beforeEach,afterEach,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { versionsDatabase,seedWorkflows } from '../fixtures/definition-versions-db.js';
import { contractsFixture,HEAD } from '../fixtures/shared-activity-contracts.js';
import { syncActivityContracts } from '../../activity-contract-sync.js';
import { createMapRouter } from '../../routes/map.js';
let fixture,db,ids,app,contracts,capabilities,activityId;
const repo='perfectuser21/zenithjoy-workspace',path='src/shared-lock.js';
const query=(extra={})=>({scope:'phones',kind:'code',repo,path,revision:HEAD,...extra});
const get=(extra={})=>request(app).get('/api/brain/map/implementation-consumers').query(query(extra));
async function seedMap(scope,capIds=capabilities,{bound=true,revision=HEAD}={}) {
  const decision=randomUUID(),manifestId=randomUUID(),runId=randomUUID();
  const manifest={scope_key:scope,schema_version:1,source_decision_id:decision,value_streams:[{key:'V',brain_binding:{entity_type:'value_stream',entity_id:ids.valueStream,source_repo:repo,source_revision:revision}}],capabilities:capIds.map((id,i)=>({key:`C${i}`,value_stream_key:'V',brain_binding:bound?{entity_type:'capability',entity_id:id,source_repo:repo,source_revision:revision}:undefined}))};
  const registryRepo=scope==='phones'?repo:`map-${scope}`;
  await db.query(`INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config) VALUES($1,$2,'legacy-ledger-v1',$3)`,[scope,registryRepo,{source_repo:repo}]);
  if(registryRepo!==repo)await db.query(`INSERT INTO fact_snapshot_headers(repo,kind,source_revision,scanner_version,scanned_at,row_count) VALUES($1,'graph',$2,'graph-v1',NOW(),1)`,[registryRepo,revision]);
  await db.query(`INSERT INTO map_manifest_versions(id,scope_key,version,source_decision_id,manifest,digest,status,activated_at) VALUES($1,$2,1,$3,$4,$5,'active',NOW())`,[manifestId,scope,decision,manifest,'c'.repeat(64)]);
  await db.query(`INSERT INTO map_projection_runs(id,scope_key,manifest_version_id,manifest_digest,fact_revisions,projector_version,projection_digest,status,activated_at) VALUES($1,$2,$3,$4,$5,'map-projector-v1',$4,'active',NOW())`,[runId,scope,manifestId,'c'.repeat(64),{[registryRepo]:revision}]);
  for(const [i,id] of capIds.entries())await db.query(`INSERT INTO map_projection_nodes(run_id,node_id,node_type,node_key,name,attributes) VALUES($1,$2,'capability',$3,'能力',$4)`,[runId,String(i+1).padStart(64,'0'),`C${i}`,bound?{brain_binding:manifest.capabilities[i].brain_binding,canonical_entity_id:id,canonical_entity_type:'capability',mapping_status:'verified'}:{}]);
}
beforeEach(async()=>{
  fixture=await versionsDatabase();db=fixture.db;ids=await seedWorkflows(db);await fixture.migrate();
  for(const table of ['map_scope_repositories','map_manifest_versions','map_projection_runs','map_projection_nodes','fact_snapshot_headers','graph_snapshot_versions','graph_edge_snapshots','journey_step_links'])await db.query(`CREATE TABLE ${table}(LIKE public.${table} INCLUDING ALL)`);
  contracts=contractsFixture();contracts.docs.keyword_acquisition.activities[0].implementation_bindings=[{kind:'code',repo,path,revision:HEAD}];contracts.refresh();
  await syncActivityContracts(db,{...contracts,readBinding:async()=>'export const lock = true;\n'});
  capabilities=(await db.query('SELECT capability_id FROM workflows ORDER BY key')).rows.map(r=>r.capability_id);
  activityId=(await db.query("SELECT id FROM journey_steps WHERE activity_key='preflight'")).rows[0].id;
  for(const id of capabilities)await db.query(`INSERT INTO journey_step_links(journey_id,step_id,step_order,assertion_ref) VALUES($1,$2,1,'tests/shared-lock.test.js')`,[id,activityId]);
  await db.query(`INSERT INTO fact_snapshot_headers(repo,kind,source_revision,scanner_version,scanned_at,row_count) VALUES($1,'graph',$2,'graph-v1',NOW(),1)`,[repo,HEAD]);
  await seedMap('phones');app=express();app.use(express.json());app.use('/api/brain/map',createMapRouter({pool:db}));
});
afterEach(async()=>{if(fixture)await fixture.close();});

it('真实HTTP按规范实现身份反查两个Workflow及位置，测试来源去重但保留两个能力',async()=>{
  const r=await get();expect(r.status,r.body).toBe(200);expect(r.body.mapping_status).toBe('verified');
  expect(r.body.activities).toHaveLength(1);expect(r.body.workflows).toHaveLength(2);expect(r.body.usages).toHaveLength(2);
  expect(new Set(r.body.workflows.map(w=>w.workflow_id))).toEqual(new Set([ids.keyword,ids.benchmark]));
  expect(r.body.usages.every(u=>u.reference_id&&u.activity_definition_version_id&&u.workflow_definition_version_id)).toBe(true);
  expect(r.body.required_assertions).toHaveLength(1);expect(r.body.required_assertions[0].source_bindings).toHaveLength(2);
  expect(r.body.required_assertions[0].capability_ids.sort()).toEqual(capabilities.slice().sort());
});
it('相同repo和地图key跨scope不串业务UUID，缺显式绑定只返回unknown',async()=>{
  await seedMap('other',[capabilities[0]]);expect((await get({scope:'other'})).body.workflows).toHaveLength(1);
  await seedMap('unbound',capabilities,{bound:false});const r=await get({scope:'unbound'});
  expect(r.body.mapping_status).toBe('unknown');expect(r.body.workflows).toEqual([]);expect(r.body.gaps).toContainEqual(expect.objectContaining({code:'capability_mapping_missing'}));
});
it('SHA、digest、完整path精确匹配，未知映射不能空集合冒充无影响',async()=>{
  for(const extra of [{revision:'b'.repeat(40)},{digest:'sha256:'+'0'.repeat(64)},{path:'shared-lock.js'}]){
    const r=await get(extra);expect(r.status).toBe(200);expect(r.body.mapping_status).toBe('unknown');expect(r.body.workflows).toEqual([]);
  }
  expect((await get({repo:'another/repo'})).status).toBe(422);
  expect((await get({path:'../shared-lock.js'})).status).toBe(400);
});
it('移除当前消费者不改历史Workflow快照；历史组织不冒充已冻结',async()=>{
  const version=(await db.query('SELECT current_definition_version_id id FROM workflows WHERE id=$1',[ids.benchmark])).rows[0].id;
  await db.query("UPDATE workflows SET status='retired' WHERE id=$1",[ids.benchmark]);await syncActivityContracts(db,{...contracts,readBinding:async()=>'export const lock = true;\n'});
  expect((await get()).body.workflows).toHaveLength(1);
  const r=await get({workflow_version_id:version});expect(r.status,r.body).toBe(200);expect(r.body.workflows.map(w=>w.workflow_id)).toEqual([ids.benchmark]);
  expect(r.body.organization_status).toBe('historical_membership_current_organization');
});
it('共享Step实现带规范locator；未注册Step身份明确unknown，不能借最新Steps补历史',async()=>{
  contracts.docs.keyword_acquisition.activities[0].implementation_bindings=[];
  contracts.docs.keyword_acquisition.activities[0].steps[0].implementation_bindings=[{kind:'skill',repo,path:'skills/lock/SKILL.md',revision:HEAD}];contracts.refresh();
  await syncActivityContracts(db,{...contracts,readBinding:async()=>'---\nname: lock\nversion: 1.0.0\n---\n# lock\n'});
  const r=await get({kind:'skill',path:'skills/lock/SKILL.md'});expect(r.status,r.body).toBe(200);expect(r.body.workflows).toHaveLength(2);
  expect(r.body.activities[0].bindings[0]).toMatchObject({scope:'step',step_key:'preflight_step',step_id:null,locator:{activity_id:activityId,step_key:'preflight_step'}});
  expect(r.body.gaps).toContainEqual(expect.objectContaining({code:'step_registration_unknown'}));
});
it('陈旧来源图与缺回归如实报告，引用核验不等于业务验证',async()=>{
  await db.query("UPDATE fact_snapshot_headers SET scanned_at=NOW()-INTERVAL '2 hours'");await db.query('DELETE FROM journey_step_links');
  const r=await get();expect(r.body.workflows).toHaveLength(2);expect(r.body.mapping_status).toBe('unknown');expect(r.body.verification_status).toBe('unknown');
  expect(r.body.gaps.map(g=>g.code)).toEqual(expect.arrayContaining(['graph_snapshot_stale','regression_missing']));
});
it('投影曾验证但业务父级已改，读取重新核规范身份而非信旧绿色',async()=>{
  const other=randomUUID();await db.query("INSERT INTO journeys(id,name) VALUES($1,'另一个价值流')",[other]);
  await db.query('UPDATE journeys SET parent_journey_id=$1 WHERE id=$2',[other,capabilities[0]]);
  const r=await get();expect(r.body.mapping_status).toBe('unknown');expect(r.body.gaps).toContainEqual(expect.objectContaining({code:'capability_authority_changed'}));
});
