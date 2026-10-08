import { beforeEach,afterEach,it,expect } from 'vitest';
import { releaseEvidenceDatabase } from '../../../__tests__/fixtures/release-evidence-db.js';
import {existsSync,readFileSync} from 'node:fs';
import {stepSha256} from '../../../../scripts/sync-steps-from-workspace.mjs';
import {readImplementationConsumers} from '../../implementation-consumers.js';
import {loadHistoricalImplementationContext} from '../../implementation-context.js';
import {exportImplementationSnapshot,validateImplementationSnapshot} from '../../implementation-ci-snapshot.js';
import * as sourceProtocol from '../../consumer-source-set.js';
const module=await import('../../capability-regressions.js').catch(()=>({}));
let f;
beforeEach(async()=>{expect(module.registerCapabilityRegression).toBeTypeOf('function');f=await releaseEvidenceDatabase();const migration=new URL('../../../../migrations/537_assertion_source_repo.sql',import.meta.url);if(existsSync(migration))await f.db.query(readFileSync(migration,'utf8'));});
afterEach(async()=>{await f?.close();f=null;});
it('准入必须核正式main run/job/实际JSON与每个repo固定main祖先，文件名或静态verified不足',()=>{
 expect(sourceProtocol.validateConsumerSourceMainEvidence).toBeTypeOf('function');
 const repo='perfectuser21/cecelia',revision='b'.repeat(40),workspace='perfectuser21/zenithjoy-workspace';
 const source_set=[{repo,revision},{repo:workspace,revision:'c'.repeat(40)}];
 const body={schema_version:1,scope:'cecelia-kr',repo,revision,status:'verified',gaps:[],canonical:{},definitions:{},map:{},assertions:[]};
 const witness={source_set,anchor:{repo,revision},run:{id:19,name:'Implementation impact',path:'.github/workflows/implementation-impact.yml',event:'workflow_dispatch',head_sha:revision,head_branch:'main',status:'completed',conclusion:'failure',repository:{full_name:repo}},jobs:[{name:'snapshot-main',status:'completed',conclusion:'success'}],artifact:{name:`implementation-snapshot-${revision}`,expired:false,workflow_run:{id:19,head_sha:revision}},snapshot:{...body,snapshot_sha256:stepSha256(body)},main_history:source_set.map(s=>({...s,current_main:s.revision,url:`https://api.github.com/repos/${s.repo}/compare/${s.revision}...${s.revision}`,comparison:{status:'identical',base_commit:{sha:s.revision},merge_base_commit:{sha:s.revision}}}))};
 expect(sourceProtocol.validateConsumerSourceMainEvidence(witness)).toBe(true);
 for(const mutate of [w=>w.run.event='pull_request',w=>w.run.head_branch='cp-fake',w=>w.jobs[0].conclusion='failure',w=>w.snapshot.revision='d'.repeat(40),w=>w.snapshot.status='unknown',w=>w.snapshot.snapshot_sha256='e'.repeat(64),w=>w.main_history.pop(),w=>w.main_history[1].comparison.status='diverged',w=>w.main_history[1].url=w.main_history[0].url,w=>w.artifact.workflow_run.id=20]){
  const bad=structuredClone(witness);mutate(bad);expect(sourceProtocol.validateConsumerSourceMainEvidence(bad)).toBe(false);
 }
});
it('共享Activity按真实消费者各登记一条断言且重放幂等，不强行改owner或置绿',async()=>{
  const activity=f.activities.find(a=>a.payload.implementation_bindings.some(b=>b.kind==='code'));
  const input={capability_id:f.capabilities[0],activity_id:activity.activity_id,assertion_ref:'scripts/smoke/regression.sh'};
  const one=await module.registerCapabilityRegression(f.db,input),replay=await module.registerCapabilityRegression(f.db,input);
  const other=await module.registerCapabilityRegression(f.db,{...input,capability_id:f.capabilities[1]});
  expect(one.registration.id).toBe(replay.registration.id);expect(one.registration.id).not.toBe(other.registration.id);
  expect(one.registration).toMatchObject({cell_status:'gray',status:'planned',step_id_ref:null,cell_level:'activity'});
});
it('真实历史完整图与地图使用Brain anchor，Workspace source_set实现身份不改WV/manifest来源',async()=>{
 const a=await seedFrozenConsumerSource(),cap=f.capabilities[0],repo='perfectuser21/zenithjoy-workspace',anchor='b'.repeat(40);
 await f.db.query("INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config) VALUES('cecelia-factory','perfectuser21/cecelia','legacy-ledger-v1',$1)",[{source_repo:repo}]);
 await f.graph(anchor,undefined,'perfectuser21/cecelia');await f.map(anchor,[cap],'cecelia-factory','perfectuser21/cecelia','perfectuser21/cecelia');
 const version=(await f.db.query("SELECT id FROM workflow_definition_versions WHERE payload->>'definition_scope'='consumer_evidence' LIMIT 1")).rows[0].id;
 const q={scope:'cecelia-factory',kind:'code',repo,path:'scripts/ci/__tests__/caller.test.mjs',revision:anchor,versionId:version};
 const gaps=[],context=await loadHistoricalImplementationContext(f.db,q,gaps);
 expect(gaps).toEqual([]);expect(context.registryRepo).toBe('perfectuser21/cecelia');expect(context.mapped.has(cap)).toBe(true);
 await module.registerCapabilityRegression(f.db,{capability_id:cap,activity_id:a.activity_id,assertion_ref:'manual:node --test scripts/ci/__tests__/caller.test.mjs',assertion_source_repo:repo});
 const report=await readImplementationConsumers(f.db,{...q,workflow_version_id:version});
 expect(report.gaps).toEqual([]);expect(report.source.repo).toBe(repo);expect(report.source.registry_repo).toBe('perfectuser21/cecelia');
 const persisted=(await f.db.query('SELECT source_repo FROM workflow_definition_versions WHERE id=$1',[version])).rows[0];expect(persisted.source_repo).toBe('perfectuser21/cecelia');
 const snapshot=await exportImplementationSnapshot(f.db,{scope:q.scope,repo:q.repo,revision:q.revision});
 expect(snapshot.status,JSON.stringify(snapshot.gaps)).toBe('verified');
 expect(snapshot.registry_source).toEqual({repo:'perfectuser21/cecelia',revision:anchor});
 expect(snapshot.source_set).toContainEqual({repo:q.repo,revision:q.revision});
 expect(snapshot.definitions.workflows[0].source_repo).toBe('perfectuser21/cecelia');
 expect(()=>validateImplementationSnapshot(snapshot)).not.toThrow();
 for(const change of [s=>s.registry_source.repo=repo,s=>s.source_set.push({...s.source_set[0]}),s=>s.source_set.push({repo:'other/repo',revision:anchor})]){
  const bad=structuredClone(snapshot);change(bad);const {snapshot_sha256,...body}=bad;bad.snapshot_sha256=stepSha256(body);
  expect(()=>validateImplementationSnapshot(bad)).toThrow();
 }
});
it('规范Step断言单独登记；错Activity/Capability归属及不可执行ref拒绝且不留半条',async()=>{
  const activity=f.activities[0],step=activity.payload.steps[0].step_id;
  const cap=f.workflows.find(w=>w.payload.activities.some(r=>r.activity_id===activity.activity_id)).payload.capability_id;
  const input={capability_id:cap,activity_id:activity.activity_id,step_id:step,assertion_ref:'scripts/smoke/regression.sh'};
  const result=await module.registerCapabilityRegression(f.db,input);expect(result.registration).toMatchObject({step_id_ref:step,cell_level:'step'});
  const before=Number((await f.db.query('SELECT count(*) FROM journey_step_links')).rows[0].count);
  for(const bad of [{...input,capability_id:f.ids.valueStream},{...input,activity_id:f.activities.find(a=>a.activity_id!==activity.activity_id).activity_id},{...input,assertion_ref:'manual:bash scripts/smoke/regression.sh;curl bad'}]){
    await expect(module.registerCapabilityRegression(f.db,bad)).rejects.toThrow();
  }
  expect(Number((await f.db.query('SELECT count(*) FROM journey_step_links')).rows[0].count)).toBe(before);
});
it('已有断言的不同新内容必须显式匹配旧值，防并发覆盖已维护登记',async()=>{
  const activity=f.activities.find(a=>a.payload.implementation_bindings.some(b=>b.kind==='code'));
  const input={capability_id:f.capabilities[0],activity_id:activity.activity_id,assertion_ref:'scripts/smoke/regression.sh'};
  await module.registerCapabilityRegression(f.db,input);
  await expect(module.registerCapabilityRegression(f.db,{...input,assertion_ref:'scripts/smoke/replacement.sh'})).rejects.toMatchObject({status:409});
  const changed=await module.registerCapabilityRegression(f.db,{...input,assertion_ref:'scripts/smoke/replacement.sh',expected_assertion_ref:input.assertion_ref});
  expect(changed.registration.assertion_ref).toBe('scripts/smoke/replacement.sh');expect(changed.registration.cell_status).toBe('gray');
});
it('幂等登记不清除其它评价者已有状态，但本次登记明确未执行验证',async()=>{
  const activity=f.activities.find(a=>a.payload.implementation_bindings.some(b=>b.kind==='code'));
  const input={capability_id:f.capabilities[0],activity_id:activity.activity_id,assertion_ref:'scripts/smoke/regression.sh'};
  const first=await module.registerCapabilityRegression(f.db,input);
  await f.db.query("UPDATE journey_step_links SET cell_status='green' WHERE id=$1",[first.registration.id]);
  const replay=await module.registerCapabilityRegression(f.db,input);
  expect(replay).toMatchObject({created:false,verification_status:'not_evaluated',registration:{cell_status:'green'}});
  expect((await f.db.query('SELECT cell_status FROM journey_step_links WHERE id=$1',[first.registration.id])).rows[0].cell_status).toBe('green');
});
it('同一UUID不同大小写不能产生第二份回归登记',async()=>{
  const activity=f.activities.find(a=>a.payload.implementation_bindings.some(b=>b.kind==='code'));
  const input={capability_id:f.capabilities[0],activity_id:activity.activity_id,assertion_ref:'scripts/smoke/regression.sh'};
  const first=await module.registerCapabilityRegression(f.db,input);
  const second=await module.registerCapabilityRegression(f.db,{...input,capability_id:input.capability_id.toUpperCase(),activity_id:input.activity_id.toUpperCase()});
  expect(second.registration.id).toBe(first.registration.id);expect(second.created).toBe(false);
});
it('迁移仅新增nullable来源列，旧回归key和null登记不变',async()=>{
 const col=(await f.db.query("SELECT is_nullable FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='activity_cells' AND column_name='assertion_source_repo'")).rows[0];
 expect(col?.is_nullable).toBe('YES');
 const a=f.activities.find(a=>a.payload.implementation_bindings.some(b=>b.kind==='code'));
 const one=await module.registerCapabilityRegression(f.db,{capability_id:f.capabilities[0],activity_id:a.activity_id,assertion_ref:'scripts/smoke/legacy.sh'});
 expect(one.registration).toMatchObject({assertion_source_repo:null,cell_key:`regression:${f.capabilities[0]}:activity`});
});
it('显式跨repo来源无冻结consumer闭包时拒绝，不能借Brain WV来源或裸路径授予归属',async()=>{
 const a=f.activities.find(a=>a.payload.implementation_bindings.some(b=>b.kind==='code'));
 await expect(module.registerCapabilityRegression(f.db,{capability_id:f.capabilities[0],activity_id:a.activity_id,assertion_ref:'manual:node --test scripts/ci/__tests__/caller.test.mjs',assertion_source_repo:'perfectuser21/zenithjoy-workspace'})).rejects.toMatchObject({code:'CAPABILITY_REGRESSION_SOURCE_UNKNOWN'});
});
async function seedFrozenConsumerSource(repo='perfectuser21/zenithjoy-workspace',digest='sha256:'+'f'.repeat(64),bad=null){
 const a=f.activities.find(a=>a.payload.implementation_bindings.some(b=>b.kind==='code')),w=f.workflows.find(w=>w.payload.capability_id===f.capabilities[0]);
 const source={repo:bad==='definition_origin'?repo:'perfectuser21/cecelia',commit:'b'.repeat(40),path:'.github/workflows/nightly-regression.yml'};
 const source_set=[{repo:'perfectuser21/cecelia',revision:'b'.repeat(40)},{repo,revision:'b'.repeat(40)}],binding={kind:'code',repo,revision:'b'.repeat(40),path:'scripts/ci/__tests__/caller.test.mjs',digest,content_sha256:'f'.repeat(64),scope:'activity',validation_scope:'consumer_source',status:'verified'};
 const payload={...a.payload,definition_scope:'consumer_evidence',source_scope:'cecelia-factory',source_set,implementation_bindings:[binding],source_set_admission:{status:bad==='admission_unknown'?'unknown':'verified',source_basis:'trusted_main_history'}};
 payload.source_set_sha256=stepSha256({source_set:payload.source_set,implementation_bindings:payload.implementation_bindings});
 if(bad==='legacy_source_set')for(const key of ['source_set','source_set_sha256','source_set_admission'])delete payload[key];
 const row=(await f.db.query('INSERT INTO activity_definition_versions(activity_id,payload,payload_sha256,source_repo,source_path,source_commit,contract_sha256) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[a.activity_id,payload,bad==='activity_hash'?'e'.repeat(64):stepSha256({source,payload}),source.repo,source.path,source.commit,stepSha256(payload.contract)])).rows[0];
 await f.db.query('UPDATE workflows SET source_repo=$2 WHERE id=$1',[w.workflow_id,'perfectuser21/cecelia']);
 const wp={...w.payload,definition_scope:'consumer_evidence',source_scope:'cecelia-factory',activities:w.payload.activities.filter(r=>r.activity_id===a.activity_id).map(r=>({...r,activity_version_id:row.id}))};
 await f.db.query('INSERT INTO workflow_definition_versions(workflow_id,payload,payload_sha256,source_repo,source_path,source_commit,contract_sha256) VALUES($1,$2,$3,$4,$5,$6,$7)',[w.workflow_id,wp,bad==='workflow_hash'?'e'.repeat(64):stepSha256({source,payload:wp}),source.repo,source.path,source.commit,stepSha256(wp.contract)]);
 return a;
}
it('固定consumer来源按repo分开回归且保旧null/key，幂等和CAS互不覆盖',async()=>{
 const a=await seedFrozenConsumerSource(),base={capability_id:f.capabilities[0],activity_id:a.activity_id,assertion_ref:'manual:node --test scripts/ci/__tests__/caller.test.mjs'};
 const legacy=await module.registerCapabilityRegression(f.db,base);
 const explicit=await module.registerCapabilityRegression(f.db,{...base,assertion_source_repo:'perfectuser21/zenithjoy-workspace'});
 const replay=await module.registerCapabilityRegression(f.db,{...base,assertion_source_repo:'perfectuser21/zenithjoy-workspace'});
 expect(explicit.registration.id).not.toBe(legacy.registration.id);expect(replay.registration.id).toBe(explicit.registration.id);
 expect(explicit.registration).toMatchObject({assertion_source_repo:'perfectuser21/zenithjoy-workspace',cell_status:'gray',status:'planned',cell_key:`regression:${f.capabilities[0]}:activity:repo:perfectuser21/zenithjoy-workspace`});
 expect((await f.db.query('SELECT * FROM activity_cells WHERE id=$1',[legacy.registration.id])).rows[0]).toMatchObject({assertion_source_repo:null,cell_key:`regression:${f.capabilities[0]}:activity`});
});
it('既有Brain consumer_evidence无新source_set时，旧null断言仍按Brain定义来源读取',async()=>{
 const repo='perfectuser21/cecelia',a=await seedFrozenConsumerSource(repo,undefined,'legacy_source_set'),cap=f.capabilities[0];
 await module.registerCapabilityRegression(f.db,{capability_id:cap,activity_id:a.activity_id,assertion_ref:'manual:node --test scripts/ci/__tests__/caller.test.mjs'});
 const version=(await f.db.query("SELECT id FROM workflow_definition_versions WHERE payload->>'definition_scope'='consumer_evidence' LIMIT 1")).rows[0].id;
 const report=await readImplementationConsumers(f.db,{scope:'cecelia-factory',kind:'code',repo,path:'scripts/ci/__tests__/caller.test.mjs',revision:'b'.repeat(40),workflow_version_id:version},{pinnedContext:{mapped:new Map([[cap,'F3']]),registryRepo:repo}});
 expect(report.gaps).toEqual([]);expect(report.required_assertions.some(r=>r.source_repo===repo&&r.source_repo_basis==='activity_definition')).toBe(true);
});
it.each(['activity_hash','workflow_hash','definition_origin','admission_unknown'])('不可信冻结历史 %s 既不能登记也不能通过读取取代来源证明',async(kind)=>{
 const a=await seedFrozenConsumerSource(undefined,undefined,kind),cap=f.capabilities[0],repo='perfectuser21/zenithjoy-workspace';
 const input={capability_id:cap,activity_id:a.activity_id,assertion_ref:'manual:node --test scripts/ci/__tests__/caller.test.mjs',assertion_source_repo:repo};
 await expect(module.registerCapabilityRegression(f.db,input)).rejects.toMatchObject({code:'CAPABILITY_REGRESSION_SOURCE_UNKNOWN'});
 const version=(await f.db.query("SELECT id FROM workflow_definition_versions WHERE payload->>'definition_scope'='consumer_evidence' LIMIT 1")).rows[0].id;
 const report=await readImplementationConsumers(f.db,{scope:'cecelia-factory',kind:'code',repo,path:'scripts/ci/__tests__/caller.test.mjs',revision:'b'.repeat(40),workflow_version_id:version},{pinnedContext:{mapped:new Map([[cap,'F3']]),registryRepo:'perfectuser21/cecelia'}});
 expect(report.mapping_status).toBe('unknown');expect(report.required_assertions.some(r=>r.source_repo===repo)).toBe(false);
});
it('冻结binding错hash或未知repo来源拒绝且不残留登记',async()=>{
 const a=await seedFrozenConsumerSource(undefined,'sha256:'+'e'.repeat(64)),input={capability_id:f.capabilities[0],activity_id:a.activity_id,assertion_ref:'manual:node --test scripts/ci/__tests__/caller.test.mjs',assertion_source_repo:'perfectuser21/zenithjoy-workspace'};
 const before=(await f.db.query('SELECT count(*) FROM activity_cells')).rows[0].count;
 await expect(module.registerCapabilityRegression(f.db,input)).rejects.toMatchObject({code:'CAPABILITY_REGRESSION_SOURCE_UNKNOWN'});
 await expect(module.registerCapabilityRegression(f.db,{...input,assertion_source_repo:'unknown/repo'})).rejects.toMatchObject({code:'CAPABILITY_REGRESSION_SOURCE_UNKNOWN'});
 expect((await f.db.query('SELECT count(*) FROM activity_cells')).rows[0].count).toBe(before);
});
it('完整冻结历史读取按实现repo选择断言，保Brain版本来源且不借旧null覆盖Workspace',async()=>{
 const a=await seedFrozenConsumerSource(),cap=f.capabilities[0],repo='perfectuser21/zenithjoy-workspace';
 const assertion='manual:node --test scripts/ci/__tests__/caller.test.mjs';
 const input={capability_id:cap,activity_id:a.activity_id,assertion_ref:assertion};
 const legacy=await module.registerCapabilityRegression(f.db,input);
 const explicit=await module.registerCapabilityRegression(f.db,{...input,assertion_source_repo:repo});
 const version=(await f.db.query("SELECT id FROM workflow_definition_versions WHERE payload->>'definition_scope'='consumer_evidence' ORDER BY created_at DESC LIMIT 1")).rows[0].id;
 const query={scope:'cecelia-factory',kind:'code',repo,path:'scripts/ci/__tests__/caller.test.mjs',revision:'b'.repeat(40),workflow_version_id:version};
 const context={mapped:new Map([[cap,'F3']]),registryRepo:'perfectuser21/cecelia',scope_status:'verified'};
 const report=await readImplementationConsumers(f.db,query,{pinnedContext:context});
 expect(report.gaps).toEqual([]);expect(report.required_assertions).toHaveLength(1);
 expect(report.activities[0].source_repo).toBe('perfectuser21/cecelia');
 expect(report.required_assertions[0]).toMatchObject({source_repo:repo,source_repo_basis:'consumer_source_set'});
 expect(report.required_assertions[0].source_bindings.map(b=>b.journey_step_link_id)).toEqual([explicit.registration.id]);
 await f.db.query('DELETE FROM activity_cells WHERE id=$1',[explicit.registration.id]);
 const missing=await readImplementationConsumers(f.db,query,{pinnedContext:context});
 expect(missing.required_assertions).toEqual([]);expect(missing.gaps).toContainEqual(expect.objectContaining({code:'regression_missing'}));
 expect((await f.db.query('SELECT assertion_source_repo FROM activity_cells WHERE id=$1',[legacy.registration.id])).rows[0].assertion_source_repo).toBeNull();
});
