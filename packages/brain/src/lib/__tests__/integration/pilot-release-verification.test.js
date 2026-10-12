import {afterEach,beforeEach,expect,it} from 'vitest';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import express from 'express';
import request from 'supertest';
import {createReleasesRouter} from '../../../routes/releases.js';
import {releaseEvidenceDatabase,RELEASE_HEAD} from '../../../__tests__/fixtures/release-evidence-db.js';
import {createRelease,getRelease} from '../../release-index.js';
import {assertPilotDefinitionSubset} from '../../pilot-release-verification.js';
import {registerCapabilityRegression} from '../../capability-regressions.js';
let f,service;
beforeEach(async()=>{expect(existsSync(new URL('../../pilot-release-verification.js',import.meta.url)),'必须有独立完整试点发布验证').toBe(true);service=await import('../../pilot-release-verification.js');f=await releaseEvidenceDatabase({fullActivityBindings:true});});
afterEach(async()=>{await f?.close();f=null;});
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function plan(){return service.buildPilotReleasePlan({scope:'phones',repo:f.releaseInput.components[0].repo,revision:RELEASE_HEAD,definitions:{workflows:f.workflows,activities:f.activities},assertions:(await f.db.query('SELECT * FROM journey_step_links ORDER BY id')).rows});}
async function cover(){
 for(const w of f.workflows)for(const ref of w.payload.activities){const a=f.activities.find(a=>a.id===ref.activity_version_id);
  for(const step of [null,...a.payload.steps.map(s=>s.step_id)])await registerCapabilityRegression(f.db,{capability_id:w.payload.capability_id,activity_id:a.activity_id,step_id:step,assertion_ref:'scripts/smoke/lock.sh'});
 }
}
it('整批真实回归可支持目标Workflow及全部依赖闭包，不要求发布无关Workflow',async()=>{
 await cover();const p=await plan(),input={...f.releaseInput,release_key:'closed-subset',workflows:f.releaseInput.workflows.slice(0,1),ci_evidence:[evidence(p)]};
 const {release}=await createRelease(f.db,input);
 expect(release.payload.verification.ci_status).toBe('verified');
 expect(release.payload.workflows).toHaveLength(1);
 const referenced=new Set(release.payload.workflows[0].payload.activities.map(r=>r.activity_version_id));
 expect(new Set(release.payload.activities.map(a=>a.id))).toEqual(referenced);
 expect(release.payload.assertion_plans[0].definition_versions).toEqual(p.definition_versions);
});
function evidence(report){report={...structuredClone(report),snapshot_sha256:'d'.repeat(64)};return {report,receipt:{schema_version:1,purpose:'release_verification',actor:'pilot_release_verification',scope:'declared_pilot_regressions',source:report.source,snapshot_sha256:report.snapshot_sha256,assertion_plan_sha256:report.assertion_plan_sha256,report_sha256:hash(report),verdict:'PASS',business_runtime_status:'not_evaluated',assertions:report.required_assertions.map(a=>({...a,source_revision:RELEASE_HEAD,test_sha256:'f'.repeat(64),exit_code:0,error:null,signal:null}))},evidence_ref:'fixture:pilot-release'};}
it('全部Activity与canonicalStep必须逐使用位置覆盖，Activity测试不能冒充Step',async()=>{
 const p=await plan();expect(p.verification_status).toBe('unknown');
 const missing=p.gaps.filter(g=>g.code==='pilot_regression_missing');expect(missing.some(g=>g.step_id)).toBe(true);
 expect(p.expected_usages.length).toBeGreaterThan(f.activities.length);
 await cover();const full=await plan();expect(full.verification_status).toBe('verified');expect(full.required_assertions.length).toBeGreaterThan(0);
});
it('真实首次release冻结完整计划，人改断言后历史读与同payload重放不漂移',async()=>{
 await cover();const p=await plan(),input={...f.releaseInput,ci_evidence:[evidence(p)]};
 const {release}=await createRelease(f.db,input);expect(release.payload.verification.ci_status).toBe('verified');
 expect(release.payload.assertion_plans[0]).toMatchObject({assertion_plan_sha256:p.assertion_plan_sha256,expected_usages:p.expected_usages});
 await f.db.query("UPDATE journey_step_links SET assertion_ref='scripts/smoke/changed.sh'");
 expect((await getRelease(f.db,release.id)).payload.assertion_plans).toEqual(release.payload.assertion_plans);
 expect((await createRelease(f.db,input)).release.id).toBe(release.id);
 const next=await createRelease(f.db,{...input,release_key:'new-after-registration-change'});expect(next.release.payload.verification.ci_status).toBe('unknown');
});
it('正式HTTP接受规范化raw描述并保留未解析原文，不允许raw替代固定Activity实现',async()=>{
 for(const fullActivityBindings of [true,false]){
  await f.close();f=await releaseEvidenceDatabase({fullActivityBindings,rawImplementationDescriptions:true});await cover();
  const raw=f.activities.flatMap(a=>a.payload.implementation_bindings.filter(b=>b.kind==='raw'));
  expect(raw.length).toBeGreaterThan(9);expect(raw.every(b=>b.status==='unresolved')).toBe(true);
  const app=express();app.use(express.json({limit:'2mb'}));app.use('/releases',createReleasesRouter({pool:f.db}));
  const r=await request(app).post('/releases').send({...f.releaseInput,ci_evidence:[evidence(await plan())]});
  expect(r.status,r.body).toBe(201);expect(r.body.release.payload.verification.status).toBe(fullActivityBindings?'verified':'unknown');
  expect((await f.db.query('SELECT payload FROM activity_definition_versions WHERE id=$1',[f.activities[0].id])).rows[0].payload).toEqual(f.activities[0].payload);
 }
});
it('漏Step/漏登记断言、重复回执、PR purpose以及篡改计划均不能发布绿',async()=>{
 await cover();const p=await plan();
 for(const [i,mutate] of [e=>e.report.expected_usages.pop(),e=>e.report.required_assertions.pop(),e=>e.receipt.assertions=[e.receipt.assertions[0],e.receipt.assertions[0]],e=>e.receipt.purpose='admission_only',e=>e.report.assertion_plan_sha256='0'.repeat(64)].entries()){
  const e=evidence(p);mutate(e);e.receipt.report_sha256=hash(e.report);
  const r=await createRelease(f.db,{...f.releaseInput,release_key:`bad-${i}`,ci_evidence:[e]});expect(r.release.payload.verification.ci_status).toBe('unknown');
 }
});
it('自洽hash不能冒充未登记scope或缺失规范映射',async()=>{
 await cover();const p=await plan(),e=evidence(p);e.report.scope='unregistered';e.report.assertion_plan_sha256=service.pilotPlanHash(service.pilotPlanBody(e.report));e.receipt.assertion_plan_sha256=e.report.assertion_plan_sha256;e.receipt.report_sha256=hash(e.report);
 const {release}=await createRelease(f.db,{...f.releaseInput,ci_evidence:[e]});expect(release.payload.verification.ci_status).toBe('unknown');
});
it('正式main refresh补齐原未登记四Step并保旧UUID，旧版本仍缺身份不能事后追认',async()=>{
 const {refreshImplementationSnapshot,exportImplementationSnapshot}=await import('../../implementation-ci-snapshot.js');
 const revision='c'.repeat(40),names=['open_benchmark_profile','list_recent_videos','resolve_video_links','persist_candidates'];
 const before=(await f.db.query('SELECT id FROM steps ORDER BY id')).rows.map(r=>r.id);
 const discovery=f.contracts.docs.benchmark_link_acquisition.activities.find(a=>a.key==='discovery');discovery.steps=[...discovery.steps,...names.map((key,i)=>({key,order:i+2,dod:{mode:'checkpoint',readback:{type:'metric',ref:'metrics.fixture_step'}}}))];f.contracts.refresh();
 for(const doc of Object.values(f.contracts.docs))for(const a of doc.activities)for(const b of a.implementation_bindings||[])b.revision=revision;
 await f.sync(revision);await f.map(revision);
 const query={scope:'phones',repo:f.releaseInput.components[0].repo,revision},old=await exportImplementationSnapshot(f.db,query);
 const oldPlan=service.buildPilotReleasePlan({...query,definitions:old.definitions,assertions:old.assertions});expect(oldPlan.gaps.filter(g=>g.code==='pilot_step_identity_missing').map(g=>g.step_key).sort()).toEqual([...names].sort());
 const fetchFn=async(...args)=>String(args[0]).includes('/commits/main')?{ok:true,text:async()=>revision}:f.contracts.fetchFn(...args);
 const next=await refreshImplementationSnapshot(f.db,query,{fetchFn,resolveToken:async()=> 'fixture',readBinding:async()=> 'export const controller=true;\n'});
 expect(next.status,next.gaps).toBe('verified');const after=(await f.db.query('SELECT id FROM steps ORDER BY id')).rows.map(r=>r.id);expect(after).toHaveLength(before.length+4);expect(before.every(id=>after.includes(id))).toBe(true);
 const frozen=(await f.db.query('SELECT payload FROM workflow_definition_versions WHERE id=$1',[old.definitions.workflows.find(w=>w.payload.activities.some(r=>old.definitions.activities.find(a=>a.id===r.activity_version_id)?.payload.steps.some(s=>!s.step_id))).id])).rows[0];expect(frozen.payload).toEqual(old.definitions.workflows.find(w=>w.payload.activities.some(r=>old.definitions.activities.find(a=>a.id===r.activity_version_id)?.payload.steps.some(s=>!s.step_id))).payload);
 for(const w of next.definitions.workflows)for(const ref of w.payload.activities){const a=next.definitions.activities.find(a=>a.id===ref.activity_version_id);for(const step of [null,...a.payload.steps.map(s=>s.step_id)])await registerCapabilityRegression(f.db,{capability_id:w.payload.capability_id,activity_id:a.activity_id,step_id:step,assertion_ref:'scripts/smoke/lock.sh'});}
 const full=await exportImplementationSnapshot(f.db,query);expect(service.buildPilotReleasePlan({...query,definitions:full.definitions,assertions:full.assertions}).verification_status).toBe('verified');expect(oldPlan.verification_status).toBe('unknown');
});
it('完整断言不能替代缺失Activity实现，只有Step绑定也不能升格',async()=>{
 await f.close();f=await releaseEvidenceDatabase();await cover();const p=await plan();
 expect(p.verification_status).toBe('unknown');expect(new Set(p.gaps.filter(g=>g.code==='pilot_activity_implementation_missing').map(g=>g.activity_id)).size).toBe(8);
 const e=evidence(p);e.report.verification_status='verified';e.report.gaps=[];e.receipt.report_sha256=hash(e.report);
 const {release}=await createRelease(f.db,{...f.releaseInput,ci_evidence:[e]});expect(release.payload.verification.ci_status).toBe('unknown');
 const definitions=structuredClone({workflows:f.workflows,activities:f.activities});for(const a of definitions.activities)a.payload.implementation_bindings=[{...f.activities.find(a=>a.payload.implementation_bindings.length).payload.implementation_bindings[0],scope:'step',step_id:a.payload.steps[0].step_id}];
 const stepOnly=service.buildPilotReleasePlan({scope:'phones',repo:p.source.repo,revision:RELEASE_HEAD,definitions,assertions:(await f.db.query('SELECT * FROM journey_step_links')).rows});expect(stepOnly.verification_status).toBe('unknown');
});

// 与真实PG发布场景同一正式回归入口，完整闭包正反例。
{
const id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
function fixture(){
 const activity=n=>({id:id(n),activity_id:id(n+10),source_repo:'perfectuser21/zenithjoy-workspace',source_commit:'a'.repeat(40),source_path:'contracts/test.yaml',payload_sha256:String(n).repeat(64),payload:{activity_id:id(n+10),steps:[]}});
 const a=activity(1),b=activity(2);
 const workflow=(n,ref)=>({id:id(n),workflow_id:id(n+10),source_repo:a.source_repo,source_commit:a.source_commit,source_path:a.source_path,payload_sha256:String(n).repeat(64),payload:{workflow_id:id(n+10),activities:[{activity_id:ref.activity_id,activity_version_id:ref.id}]}});
 const w=workflow(3,a),other=workflow(4,b);
 return {full:{workflows:[w,other],activities:[a,b]},subset:{workflows:[structuredClone(w)],activities:[structuredClone(a)]}};
}
it('完整CI的目标闭包可消费，完整集合仍保持兼容',()=>{
 const f=fixture();expect(assertPilotDefinitionSubset(f.full,f.subset)).toBe(true);expect(assertPilotDefinitionSubset(f.full,f.full)).toBe(true);
});
it.each([
 ['空Workflow',f=>f.subset.workflows=[]],
 ['缺依赖',f=>f.subset.activities=[]],
 ['无关依赖',f=>f.subset.activities.push(f.full.activities[1])],
 ['重复Workflow',f=>f.subset.workflows.push(f.subset.workflows[0])],
 ['重复依赖',f=>f.subset.activities.push(f.subset.activities[0])],
 ['未知版本',f=>f.subset.workflows[0].id=id(99)],
 ['错摘要',f=>f.subset.activities[0].payload_sha256='f'.repeat(64)],
 ['错来源',f=>f.subset.activities[0].source_commit='b'.repeat(40)],
 ['篡改原文',f=>f.subset.activities[0].payload.steps.push({key:'forged'})],
 ['完整快照重复版本',f=>f.full.workflows.push(f.full.workflows[0])],
 ['引用错逻辑身份',f=>{f.full.workflows[0].payload.activities[0].activity_id=id(99);f.subset.workflows[0]=structuredClone(f.full.workflows[0]);}],
])('%s不能借整批CI放行',(_,mutate)=>{
 const f=fixture();mutate(f);expect(()=>assertPilotDefinitionSubset(f.full,f.subset)).toThrow();
});
}
