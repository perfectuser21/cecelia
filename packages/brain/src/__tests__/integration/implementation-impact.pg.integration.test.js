import { beforeEach,afterEach,it,expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { implementationImpactDatabase,IMPACT_REPO as repo } from '../fixtures/implementation-impact-db.js';
import { createMapRouter } from '../../routes/map.js';
import {stepSha256} from '../../../scripts/sync-steps-from-workspace.mjs';
const BASE='a'.repeat(40),HEAD='b'.repeat(40);
let fixture,db,ids,app,capabilities,graph,map,advance;
const input=(extra={})=>({scope:'phones',repo,base_revision:BASE,head_revision:HEAD,changed_files:['src/shared-lock.js'],...extra});
const post=extra=>request(app).post('/map/implementation-impact').send(input(extra));
beforeEach(async()=>{
  fixture=await implementationImpactDatabase();({db,ids,capabilities,graph,map,advance}=fixture);
  app=express();app.use(express.json());app.use('/map',createMapRouter({pool:db}));
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
it('head明确删除最后引用是known_removed，保留base消费者与回归断言',async()=>{
  fixture.contracts.docs.keyword_acquisition.activities=fixture.contracts.docs.keyword_acquisition.activities.filter(a=>a.key!=='preflight');
  await advance({remove:true,bindings:[]});
  const r=await post();expect(r.status,r.body).toBe(200);expect(r.body.head.affected_usages).toEqual([]);
  expect(r.body.head.impact_status).toBe('known_removed');expect(r.body.head.removal_evidence).toHaveLength(2);
  expect(r.body.mapping_status).toBe('verified');expect(r.body.affected_usages).toHaveLength(2);expect(r.body.required_assertions).toHaveLength(1);
  expect(r.body.affected_usages.every(u=>u.sides.join(',')==='base')).toBe(true);
});
it('技能绑定同样沿精确逆向边找到两个共享使用者',async()=>{
  await advance({bindings:[{kind:'skill',repo,path:'skills/controller/SKILL.md'}],edges:[['skills/controller/SKILL.md','src/shared-lock.js']]});
  const r=await post();expect(r.status,r.body).toBe(200);expect(r.body.head.affected_usages).toHaveLength(2);
  expect(r.body.head.affected_usages.every(u=>u.implementation.kind==='skill')).toBe(true);
});
it('同revision多投影须显式digest消歧，绑定来源漂移不能伪verified',async()=>{
  await advance();
  const projection=(await db.query("SELECT * FROM map_projection_runs WHERE status='active'")).rows[0];
  await db.query("INSERT INTO map_projection_runs(scope_key,manifest_version_id,manifest_digest,fact_revisions,projector_version,projection_digest,status,activated_at) VALUES($1,$2,$3,$4,'other-projector',$5,'superseded',NOW())",['phones',projection.manifest_version_id,projection.manifest_digest,projection.fact_revisions,'e'.repeat(64)]);
  let r=await post();expect(r.status,r.body).toBe(200);expect(r.body.head.gaps).toContainEqual(expect.objectContaining({code:'projection_snapshot_ambiguous'}));expect(r.body.mapping_status).toBe('unknown');
  r=await post({head_projection_digest:projection.projection_digest});expect(r.status,r.body).toBe(200);expect(r.body.mapping_status).toBe('verified');
  const drift=await map(HEAD,capabilities,'phones','phone-source',repo,{capabilityRevision:BASE});
  r=await post({head_projection_digest:drift.digest});expect(r.status,r.body).toBe(200);expect(r.body.mapping_status).toBe('unknown');expect(r.body.head.gaps).toContainEqual(expect.objectContaining({code:'capability_source_mismatch'}));
});
it('逐changed_file核覆盖，已映射共享依赖不能掩盖新入口缺口',async()=>{
  await advance();const r=await post({changed_files:['src/shared-lock.js','src/new-api.js']});
  expect(r.status,r.body).toBe(200);expect(r.body.affected_usages).toHaveLength(2);expect(r.body.mapping_status).toBe('unknown');
  expect(r.body.unclaimed_paths).toEqual([{path:'src/new-api.js'}]);expect(r.body.gaps).toContainEqual(expect.objectContaining({code:'changed_file_unclaimed',path:'src/new-api.js'}));
});
it('最后引用删除证据不能掩盖同次变更的另一未知新入口',async()=>{
  fixture.contracts.docs.keyword_acquisition.activities=fixture.contracts.docs.keyword_acquisition.activities.filter(a=>a.key!=='preflight');
  await advance({remove:true,bindings:[]});const r=await post({changed_files:['src/shared-lock.js','src/new-api.js']});
  expect(r.status,r.body).toBe(200);expect(r.body.head.impact_status).toBe('known_removed');expect(r.body.mapping_status).toBe('unknown');expect(r.body.unclaimed_paths).toEqual([{path:'src/new-api.js'}]);
});
it('新增入口有固定head绑定且base快照证明确未绑定时known_added，缺base证据仍unknown',async()=>{
  await advance({bindings:[{kind:'code',repo,path:'src/new-entry.js'}],edges:[]});
  let r=await post({changed_files:['src/new-entry.js']});expect(r.status,r.body).toBe(200);expect(r.body.head.affected_usages).toHaveLength(2);
  expect(r.body.base.impact_status).toBe('known_added');expect(r.body.base.addition_evidence).toHaveLength(2);expect(r.body.mapping_status).toBe('verified');
  expect(r.body.required_assertions[0].source_repo_basis).toBe('activity_definition');expect(r.body.required_assertions[0].source_bindings.every(b=>b.source_repo_basis==='activity_definition')).toBe(true);
  await db.query('DELETE FROM graph_edge_snapshots WHERE source_revision=$1',[BASE]);await db.query('DELETE FROM graph_snapshot_versions WHERE source_revision=$1',[BASE]);
  r=await post({changed_files:['src/new-entry.js']});expect(r.status,r.body).toBe(200);expect(r.body.mapping_status).toBe('unknown');expect(r.body.base.gaps).toContainEqual(expect.objectContaining({code:'graph_snapshot_missing'}));
});
it('公开历史GET按旧version固定scope地图，head移除能力不能抹去base使用关系',async()=>{
  const version=(await db.query('SELECT current_definition_version_id id FROM workflows WHERE id=$1',[ids.benchmark])).rows[0].id;
  const cap=(await db.query('SELECT capability_id FROM workflows WHERE id=$1',[ids.keyword])).rows[0].capability_id;
  await advance({remove:true,capIds:[cap]});
  await db.query("INSERT INTO fact_snapshot_headers(kind,repo,source_revision,scanner_version,scanned_at,row_count) VALUES('graph','phone-source',$1,'graph-v1',NOW(),1)",[HEAD]);
  const get=()=>request(app).get('/map/implementation-consumers').query({scope:'phones',kind:'code',repo,path:'src/controller.js',revision:BASE,workflow_version_id:version});
  let r=await get();expect(r.status,r.body).toBe(200);expect(r.body.workflows.map(w=>w.workflow_id)).toEqual([ids.benchmark]);
  expect(r.body.organization_status).toBe('historical_membership_unknown_organization');expect(r.body.mapping_status).toBe('verified');
  await db.query("DELETE FROM map_projection_runs WHERE fact_revisions->>'phone-source'=$1",[BASE]);
  r=await get();expect(r.status,r.body).toBe(200);expect(r.body.mapping_status).toBe('unknown');expect(r.body.scope_status).toBe('unknown');expect(r.body.workflows.map(w=>w.workflow_id)).toEqual([ids.benchmark]);
  expect(r.body.gaps).toContainEqual(expect.objectContaining({code:'projection_snapshot_missing'}));
});

const BRAIN='perfectuser21/cecelia';
async function factorySourceSide(revision,anchor,{badHash=false,badSet=false}={}) {
 const a=(await db.query('SELECT * FROM activity_definition_versions WHERE source_repo=$1 ORDER BY created_at LIMIT 1',[repo])).rows[0];
 const w=(await db.query('SELECT * FROM workflow_definition_versions WHERE workflow_id=$1 ORDER BY created_at LIMIT 1',[ids.keyword])).rows[0];
 const source={repo:BRAIN,path:a.source_path,commit:anchor};
 const binding={kind:'code',repo,revision,path:'src/controller.js',scope:'activity',status:'verified',validation_scope:'consumer_source',content_sha256:'f'.repeat(64),digest:'sha256:'+'f'.repeat(64)};
 const payload={...a.payload,definition_scope:'consumer_evidence',source_scope:'cecelia-factory',source_set:[{repo:BRAIN,revision:anchor},{repo,revision}],source_set_admission:{status:'verified',source_basis:'trusted_main_history'},implementation_bindings:[binding]};
 payload.source_set_sha256=badSet?'e'.repeat(64):stepSha256({source_set:payload.source_set,implementation_bindings:payload.implementation_bindings});
 const av=(await db.query('INSERT INTO activity_definition_versions(activity_id,payload,payload_sha256,source_repo,source_path,source_commit,contract_sha256) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[a.activity_id,payload,badHash?'e'.repeat(64):stepSha256({source,payload}),BRAIN,source.path,anchor,stepSha256(payload.contract)])).rows[0];
 const wp={...w.payload,definition_scope:'consumer_evidence',source_scope:'cecelia-factory',activities:w.payload.activities.filter(r=>r.activity_id===a.activity_id).map(r=>({...r,activity_version_id:av.id}))};
 await db.query('INSERT INTO workflow_definition_versions(workflow_id,payload,payload_sha256,source_repo,source_path,source_commit,contract_sha256) VALUES($1,$2,$3,$4,$5,$6,$7)',[w.workflow_id,wp,stepSha256({source,payload:wp}),BRAIN,source.path,anchor,stepSha256(wp.contract)]);
 await graph(anchor,[],BRAIN);await map(anchor,[wp.capability_id],'cecelia-factory',BRAIN,BRAIN);
}
async function factorySourceFixture(options={}) {
 await db.query("INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config) VALUES('cecelia-factory',$1,'legacy-ledger-v1',$2)",[BRAIN,{source_repo:repo}]);
 await db.query('ALTER TABLE activity_cells ADD COLUMN assertion_source_repo TEXT');await db.query('UPDATE activity_cells SET assertion_source_repo=$1',[repo]);
 await graph(BASE,undefined,repo);await graph(HEAD,undefined,repo);
 await factorySourceSide(BASE,'c'.repeat(40),options);await factorySourceSide(HEAD,'d'.repeat(40),options);
}
it('跨repo完整impact按Workspace图遍历，Brain固定定义和地图来源保持独立',async()=>{
 await factorySourceFixture();const r=await post({scope:'cecelia-factory'});
 expect(r.status,r.body).toBe(200);expect(r.body.mapping_status,r.body.gaps).toBe('verified');expect(r.body.affected_usages).toHaveLength(1);
 for(const side of ['base','head']){expect(r.body[side].graph_snapshot.repo).toBe(repo);expect(r.body[side].definition_versions.workflows.every(w=>w.source_repo===BRAIN)).toBe(true);expect(r.body[side].projection.fact_revisions[BRAIN]).toBe((side==='base'?'c':'d').repeat(40));}
 expect(r.body.required_assertions[0].source_repo).toBe(repo);expect(r.body.verification_status).toBe('unknown');
});
it('跨repoimpact拒绝错AV封印，不借同路径legacy定义授予归属',async()=>{
 await factorySourceFixture({badHash:true});const r=await post({scope:'cecelia-factory'});expect(r.body.mapping_status).toBe('unknown');expect(r.body.affected_usages).toEqual([]);
});
it('跨repoimpact缺Workspace精确图不能借Brain图或其他adapter图通过',async()=>{
 await factorySourceFixture();await db.query('DELETE FROM graph_edge_snapshots WHERE repo=$1',[repo]);await db.query('DELETE FROM graph_snapshot_versions WHERE repo=$1',[repo]);
 const r=await post({scope:'cecelia-factory'});expect(r.body.mapping_status).toBe('unknown');expect(r.body.affected_usages).toEqual([]);expect(r.body.gaps).toContainEqual(expect.objectContaining({code:'graph_snapshot_missing',repo}));
});
it('同实现SHA多个Brain anchor须明确未知，不能latest消歧',async()=>{
 await factorySourceFixture();await factorySourceSide(HEAD,'e'.repeat(40));const r=await post({scope:'cecelia-factory'});expect(r.body.mapping_status).toBe('unknown');expect(r.body.head.gaps).toContainEqual(expect.objectContaining({code:'consumer_source_anchor_ambiguous'}));
});
