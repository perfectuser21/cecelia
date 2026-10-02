import { beforeEach,afterEach,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { versionsDatabase,seedWorkflows } from '../fixtures/definition-versions-db.js';
import { contractsFixture,HEAD as BASE } from '../fixtures/shared-activity-contracts.js';
import { syncActivityContracts } from '../../activity-contract-sync.js';
import { createMapRouter } from '../../routes/map.js';
const HEAD='b'.repeat(40),repo='perfectuser21/zenithjoy-workspace',registry='phone-source';
let fixture,db,ids,contracts,app,capabilities;
const input=(extra={})=>({scope:'phones',repo,base_revision:BASE,head_revision:HEAD,changed_files:['src/shared-lock.js'],...extra});
const post=extra=>request(app).post('/map/implementation-impact').send(input(extra));
async function graph(revision,edges=[['src/controller.js','src/shared-lock.js']],key=registry){
  await db.query("INSERT INTO graph_snapshot_versions(repo,source_revision,scanner_version,row_count,scanned_at) VALUES($1,$2,'graph-v1',$3,NOW())",[key,revision,edges.length]);
  for(const [src,dst] of edges) await db.query("INSERT INTO graph_edge_snapshots(repo,source_revision,src_path,dst_path,edge_type) VALUES($1,$2,$3,$4,'import')",[key,revision,src,dst]);
}
async function map(revision,capIds=capabilities,scope='phones',key=registry,sourceRepo=repo){
  await db.query("UPDATE map_manifest_versions SET status='superseded' WHERE scope_key=$1",[scope]);
  await db.query("UPDATE map_projection_runs SET status='superseded' WHERE scope_key=$1",[scope]);
  const id=randomUUID(),run=randomUUID(),digest=(revision===BASE?'c':'d').repeat(64);
  const binding=(type,entity_id)=>({entity_type:type,entity_id,source_repo:sourceRepo,source_revision:revision});
  const manifest={scope_key:scope,schema_version:1,value_streams:[{key:'flow',brain_binding:binding('value_stream',ids.valueStream)}],capabilities:capIds.map((cap,i)=>({key:`F${i}`,value_stream_key:'flow',brain_binding:binding('capability',cap)}))};
  await db.query("INSERT INTO map_manifest_versions(id,scope_key,version,source_decision_id,manifest,digest,status,activated_at) VALUES($1,$2,$3,$4,$5,$6,'active',NOW())",[id,scope,revision===BASE?1:2,randomUUID(),manifest,digest]);
  await db.query("INSERT INTO map_projection_runs(id,scope_key,manifest_version_id,manifest_digest,fact_revisions,projector_version,projection_digest,status,activated_at) VALUES($1,$2,$3,$4,$5,'binding-v2',$4,'active',NOW())",[run,scope,id,digest,{[key]:revision}]);
  for(const node of manifest.capabilities)await db.query("INSERT INTO map_projection_nodes(run_id,node_id,node_type,node_key,name,attributes) VALUES($1,$2,'capability',$3,'能力',$4)",[run,randomUUID().replaceAll('-','').padStart(64,'0'),node.key,{brain_binding:node.brain_binding,canonical_entity_id:node.brain_binding.entity_id,mapping_status:'verified'}]);
  return {id,run,digest};
}
async function sync(revision){
  contracts.docs.keyword_acquisition.activities[0].implementation_bindings=[{kind:'code',repo,path:'src/controller.js',revision}];contracts.refresh();
  const fetchFn=async(...args)=>String(args[0]).includes('/commits/main')?{ok:true,text:async()=>revision}:contracts.fetchFn(...args);
  await syncActivityContracts(db,{...contracts,fetchFn,readBinding:async()=>'export const controller=true;\n'});
}
async function advance({remove=false,capIds=capabilities,edges}={}){
  if(remove)contracts.docs.benchmark_link_acquisition.activities=contracts.docs.benchmark_link_acquisition.activities.filter(a=>a.ref!=='keyword_acquisition.preflight');
  await sync(HEAD); await graph(HEAD,edges); await map(HEAD,capIds);
}
beforeEach(async()=>{
  fixture=await versionsDatabase();db=fixture.db;ids=await seedWorkflows(db);await fixture.migrate();
  for(const table of ['map_scope_repositories','map_manifest_versions','map_projection_runs','map_projection_nodes','graph_snapshot_versions','graph_edge_snapshots','journey_step_links'])await db.query(`CREATE TABLE ${table}(LIKE public.${table} INCLUDING ALL)`);
  contracts=contractsFixture(); await sync(BASE);
  capabilities=(await db.query('SELECT capability_id FROM workflows ORDER BY key')).rows.map(r=>r.capability_id);
  const activity=(await db.query("SELECT id FROM journey_steps WHERE activity_key='preflight'")).rows[0].id;
  for(const cap of capabilities)await db.query("INSERT INTO journey_step_links(journey_id,step_id,step_order,assertion_ref) VALUES($1,$2,1,'tests/controller.test.js')",[cap,activity]);
  await db.query("INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config) VALUES('phones',$1,'legacy-ledger-v1',$2)",[registry,{source_repo:repo}]);
  await graph(BASE); await map(BASE);app=express();app.use(express.json());app.use('/map',createMapRouter({pool:db}));
});
afterEach(async()=>{await fixture?.close();});
it('精确逆向共享controller找到两个Workflow；固定双版本证据与使用位置并集',async()=>{
  await advance();const r=await post();expect(r.status,r.body).toBe(200);const report=r.body;
  expect(report.source).toEqual({repo,base_revision:BASE,head_revision:HEAD,changed_files:[{path:'src/shared-lock.js'}]});
  expect(report.mapping_status).toBe('verified');expect(report.verification_status).toBe('unknown');
  expect(report.affected_usages).toHaveLength(2);expect(new Set(report.affected_usages.map(u=>u.workflow_id))).toEqual(new Set([ids.keyword,ids.benchmark]));
  expect(report.affected_usages.every(u=>u.sides.includes('base')&&u.sides.includes('head')&&u.evidence.length===2)).toBe(true);
  for(const side of ['base','head']){expect(report[side].graph_snapshot.digest).toMatch(/^[a-f0-9]{64}$/);expect(report[side].projection.projection_run_id).toBeTruthy();expect(report[side].definition_versions.workflows).toHaveLength(2);}
  expect(report.required_assertions).toHaveLength(1);expect(report.required_assertions[0].source_repo).toBe(repo);expect(report.required_assertions[0].source_bindings.every(b=>b.capability_id&&b.activity_id)).toBe(true);
});
it('head去共享且地图删掉旧能力，base旧Workflow仍在并集，组织历史明确未知',async()=>{
  const cap=(await db.query('SELECT capability_id FROM workflows WHERE id=$1',[ids.keyword])).rows[0].capability_id;
  await advance({remove:true,capIds:[cap]});const r=await post();expect(r.status,r.body).toBe(200);
  const retiredUsage=r.body.affected_usages.find(u=>u.workflow_id===ids.benchmark);expect(retiredUsage.sides).toEqual(['base']);
  expect(r.body.base.organization_status).toBe('historical_membership_unknown_organization');
  expect(r.body.base.definition_versions.workflows.every(v=>v.source_commit===BASE)).toBe(true);
});
it('同路径跨repo不串，后缀相似路径不命中',async()=>{
  await advance();
  await db.query("INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config) VALUES('other','other-source','legacy-ledger-v1',$1)",[{source_repo:'other/repo'}]);
  await graph(BASE,undefined,'other-source');await graph(HEAD,undefined,'other-source');await map(BASE,capabilities,'other','other-source','other/repo');await map(HEAD,capabilities,'other','other-source','other/repo');
  for(const extra of [{scope:'other',repo:'other/repo'},{changed_files:['shared-lock.js']}]){const r=await post(extra);expect(r.status,r.body).toBe(200);expect(r.body.affected_usages).toEqual([]);expect(r.body.mapping_status).toBe('unknown');}
});
it('超过10层显式truncated；足够界限穿越有环图不漏消费者',async()=>{
  const edges=[['src/controller.js','src/dep12.js'],...Array.from({length:12},(_,i)=>[`src/dep${i+1}.js`,`src/dep${i}.js`]),['src/dep3.js','src/dep5.js']];
  await advance({edges});
  const cut=await post({changed_files:['src/dep0.js'],max_depth:10});expect(cut.status,cut.body).toBe(200);expect(cut.body.head.traversal.truncated).toBe(true);expect(cut.body.mapping_status).toBe('unknown');
  const all=await post({changed_files:['src/dep0.js'],max_depth:32});expect(all.status,all.body).toBe(200);expect(all.body.head.traversal.truncated).toBe(false);expect(all.body.head.affected_usages).toHaveLength(2);
});
it('缺精确graph或定义快照均unknown，不能latest冒充head',async()=>{
  await map(HEAD);let r=await post();expect(r.status,r.body).toBe(200);expect(r.body.head.gaps).toContainEqual(expect.objectContaining({code:'graph_snapshot_missing'}));expect(r.body.head.affected_usages).toEqual([]);
  await graph(HEAD);r=await post();expect(r.status,r.body).toBe(200);expect(r.body.head.gaps).toContainEqual(expect.objectContaining({code:'definition_snapshot_missing'}));expect(r.body.head.affected_usages).toEqual([]);expect(r.body.mapping_status).toBe('unknown');
});
it('改名保留old_path作为base起点，head只走新路径',async()=>{
  await advance({edges:[['src/controller.js','src/renamed-lock.js']]});
  const r=await post({changed_files:[{path:'src/renamed-lock.js',old_path:'src/shared-lock.js'}]});expect(r.status,r.body).toBe(200);
  expect(r.body.base.traversal.paths).toContain('src/shared-lock.js');expect(r.body.head.traversal.paths).toContain('src/renamed-lock.js');expect(r.body.affected_usages).toHaveLength(2);
});
it('固定版本输入严格检查数组、非法路径及内部鉴权',async()=>{
  for(const extra of [{base_revision:[BASE]},{changed_files:['../controller.js']},{max_depth:0}])expect((await post(extra)).status).toBe(400);
  const prior=process.env.CECELIA_INTERNAL_TOKEN;process.env.CECELIA_INTERNAL_TOKEN='impact-fixture-token';
  try{expect((await post()).status).toBe(401);}finally{if(prior===undefined)delete process.env.CECELIA_INTERNAL_TOKEN;else process.env.CECELIA_INTERNAL_TOKEN=prior;}
});
