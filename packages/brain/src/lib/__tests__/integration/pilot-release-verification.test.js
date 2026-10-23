import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import * as fixedGit from '../../../workflow-authoring/fixed-git-source.js';
import {prepareAuthoringReleaseProof} from '../../../workflow-authoring/release-proof.js';
import {existsSync} from 'node:fs';
import {request as httpRequest} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {migrationTable} from '../../../__tests__/fixtures/minimum-definition-schema.js';
import {registerWorkflow,registrationDigest} from '../../../workflow-authoring/registration.js';
import {prepareDefinitionFreeze} from '../../../workflow-authoring/freeze.js';
import {exportImplementationSnapshot} from '../../implementation-ci-snapshot.js';
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
 ['错Workflow逻辑身份',f=>f.subset.workflows[0].workflow_id=id(99)],
 ['错摘要',f=>f.subset.activities[0].payload_sha256='f'.repeat(64)],
 ['错来源',f=>f.subset.activities[0].source_commit='b'.repeat(40)],
 ['篡改原文',f=>f.subset.activities[0].payload.steps.push({key:'forged'})],
 ['完整快照重复版本',f=>f.full.workflows.push(f.full.workflows[0])],
 ['引用错逻辑身份',f=>{f.full.workflows[0].payload.activities[0].activity_id=id(99);f.subset.workflows[0]=structuredClone(f.full.workflows[0]);}],
])('%s不能借整批CI放行',(_,mutate)=>{
 const f=fixture();mutate(f);expect(()=>assertPilotDefinitionSubset(f.full,f.subset)).toThrow();
});
}

async function twoScopeRelease({sourceProof=false}={}){
 await cover();const legacy=evidence(await plan()),repo=f.releaseInput.components[0].repo,skill=randomUUID();
 await f.db.query(migrationTable('283_skill_registry_and_journey_step_links.sql','skill_registry'));
 await f.db.query("INSERT INTO skill_registry(id,name,location,status) VALUES($1,'workflow-commander','/skills/commander','active')",[skill]);
 const definition={key:'workflow_report',name:'报告',capability_id:f.workflows[0].payload.capability_id,channel:'internal',form:'openclaw_skill',version:'1.0.0',
  source:{repo,ref:'commander/report.json',revision:RELEASE_HEAD},runtime:{skill_id:skill,entrypoint:'workflow-commander'},
  activities:[{key:'report',name:'生成报告',executor_kind:'code',acceptance:['报告可回读'],implementation:{kind:'code',ref:'src/controller.js',version:'1.0.0',repo,path:'src/controller.js',revision:'contract'},
   steps:[{key:'read',name:'读回',dod:{mode:'checkpoint',readback:{type:'json',path:'report.json'}}}]}]};
 const {source,...document}=definition;
 const readFile=async s=>s.path===source.ref?JSON.stringify(document):'export const controller=true;\n';
 const freezeProof=await prepareDefinitionFreeze(definition,{readFile});
 const db=await f.db.connect();try{await db.query('BEGIN');await registerWorkflow(db,definition,{definitionSha256:registrationDigest(definition),registrationProtocol:'definition-freeze-v1',freezeProof});await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
 await f.db.query("INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config) VALUES('commander-generic','commander-source','legacy-ledger-v1',$1)",[{source_repo:repo,definition_protocol:'definition-freeze-v1',workflow_keys:[definition.key]}]);
 await f.map(RELEASE_HEAD,[definition.capability_id],'commander-generic','commander-source');
 const query={scope:'commander-generic',repo,revision:RELEASE_HEAD};let snapshot=await exportImplementationSnapshot(f.db,query);
 expect(snapshot.status,JSON.stringify(snapshot.gaps)).toBe('verified');
 const a=snapshot.definitions.activities[0];for(const step_id of [null,...a.payload.steps.map(s=>s.step_id)])await registerCapabilityRegression(f.db,{capability_id:definition.capability_id,activity_id:a.activity_id,step_id,assertion_ref:'scripts/smoke/report.sh'});
 snapshot=await exportImplementationSnapshot(f.db,query);
 const proof=sourceProof?await prepareAuthoringReleaseProof(snapshot,{readFile}):null;
 const authoring=evidence(service.buildPilotReleasePlan({...query,definitions:snapshot.definitions,assertions:snapshot.assertions,...(proof?{authoringSnapshot:snapshot,authoringProof:proof}:{})}));
 if(proof){authoring.report.snapshot_sha256=snapshot.snapshot_sha256;authoring.receipt.snapshot_sha256=snapshot.snapshot_sha256;authoring.receipt.report_sha256=hash(authoring.report);}
 const input={...structuredClone(f.releaseInput),workflows:[...f.releaseInput.workflows,...snapshot.definitions.workflows.map(w=>({workflow_definition_version_id:w.id,payload_sha256:w.payload_sha256}))],ci_evidence:[legacy,authoring]};
 return sourceProof?{input,readFile}:input;
}
it('真实PG同repo两scope完整证据联合覆盖同release，逐份仍冻结完整断言计划',async()=>{
 const input=await twoScopeRelease(),{release}=await createRelease(f.db,input);
 expect(release.payload.verification.ci_status,JSON.stringify(release.payload.verification.gaps)).toBe('verified');
 expect(release.payload.workflows).toHaveLength(3);expect(release.payload.assertion_plans).toHaveLength(2);
 expect(new Set(release.payload.assertion_plans.map(p=>p.scope))).toEqual(new Set(['phones','commander-generic']));
 expect((await getRelease(f.db,release.id)).payload.assertion_plans.map(p=>p.required_assertions)).toEqual(input.ci_evidence.map(e=>e.report.required_assertions));
});
it('真实PG联合证据缺一、错版本或篡改不能按相同repo冒作全部覆盖',async()=>{
 const input=await twoScopeRelease();
 for(const [index,mutate] of [
  e=>e.splice(1,1),e=>e.splice(0,1),
  e=>e[1].report.definition_versions.workflows[0].id=randomUUID(),
  e=>e[1].report.definition_versions.activities[0].payload_sha256='0'.repeat(64),
  e=>e[1].report.definition_versions.activities[0].source_commit='c'.repeat(40),
  e=>e[1].receipt.assertions[0].exit_code=1,
  e=>e[1].receipt.assertions.pop(),
  e=>{const bad=structuredClone(e[1]);bad.receipt.assertions[0].exit_code=1;e.push(bad);},
 ].entries()){
  const copy=structuredClone(input);copy.release_key=`union-invalid-${index}`;mutate(copy.ci_evidence);
  for(const e of copy.ci_evidence){e.report.assertion_plan_sha256=service.pilotPlanHash(service.pilotPlanBody(e.report));e.receipt.assertion_plan_sha256=e.report.assertion_plan_sha256;e.receipt.report_sha256=hash(e.report);}
  const {release}=await createRelease(f.db,copy);expect(release.payload.verification.ci_status,`case ${index}`).toBe('unknown');
  expect((await getRelease(f.db,release.id)).payload.verification.status).toBe('unknown');
  if(index<2)expect(release.payload.verification.gaps.some(g=>g.code==='ci_definition_evidence_missing'&&g.kind==='workflows')).toBe(true);
  else expect(release.payload.verification.gaps.some(g=>g.code==='pilot_release_unverified')).toBe(true);
 }
});

// 真实PG与正式来源读取接缝：外部Git等待不可持有登记表锁。
async function pendingSource(){
 const {input,readFile}=await twoScopeRelease({sourceProof:true});
 let entered,unblock;const started=new Promise(r=>{entered=r;}),pending=new Promise(r=>{unblock=r;});
 const spy=vi.spyOn(fixedGit,'readFixedGitFile').mockImplementation(async(source,options)=>{
  entered(options);await pending;return readFile(source);
 });
 return {input,started,unblock,restore:()=>spy.mockRestore()};
}
const outcome=p=>p.then(value=>({value}),error=>({error}));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
it('真实PG来源pending不阻塞无关登记writer，完成后仍为同一verified发布',async()=>{
 const x=await pendingSource(),running=outcome(createRelease(f.db,x.input));
 let writer;try{
  await x.started;expect(f.db.idleCount).toBe(f.db.totalCount);
  expect((await f.db.query("SELECT count(*)::int n FROM pg_locks WHERE relation='activities'::regclass AND pid<>pg_backend_pid()")).rows[0].n).toBe(0);
  writer=await f.db.connect();await writer.query("SET statement_timeout='300ms'");
  await writer.query('UPDATE warehouse_items SET name=name WHERE id=$1',[f.enabler]);
  x.unblock();const result=await running;
  expect(result.error).toBeUndefined();expect(result.value.release.payload.verification.status).toBe('verified');
 }finally{x.unblock();await running;if(writer){await writer.query('RESET statement_timeout');writer.release();}x.restore();}
});
it.each(['map_scope_repositories','activity_cells'])('真实PG在线核验后%s漂移拒绝写入，不能沿用先前proof',async table=>{
 const x=await pendingSource(),running=outcome(createRelease(f.db,x.input));
 try{
  await x.started;
  if(table==='map_scope_repositories')await f.db.query("UPDATE map_scope_repositories SET adapter_config=adapter_config||$1::jsonb WHERE scope_key='commander-generic'",[{source_repo:"perfectuser21/cecelia"}]);
  else await f.db.query("UPDATE activity_cells SET assertion_ref='scripts/smoke/changed.sh'");
  x.unblock();expect((await running).error).toMatchObject({code:'RELEASE_REGISTRATION_CHANGED'});
  expect((await f.db.query('SELECT count(*)::int n FROM release_versions')).rows[0].n).toBe(0);
 }finally{x.unblock();await running;x.restore();}
});
it.each(['deadline','cancel'])('真实PG来源%s有整体边界，取消后不落部分release',async mode=>{
 const x=await pendingSource(),controller=new AbortController();
 const running=outcome(createRelease(f.db,x.input,{signal:controller.signal,timeoutMs:mode==='deadline'?200:2000}));
 try{
  await x.started;if(mode==='cancel')controller.abort();
  const result=await Promise.race([running,wait(600).then(()=>({stillPending:true}))]);
  expect(result.stillPending).toBeUndefined();
  expect(result.error).toMatchObject({code:mode==='deadline'?'RELEASE_VALIDATION_TIMEOUT':'RELEASE_REQUEST_ABORTED'});
  x.unblock();await running;
  expect((await f.db.query('SELECT count(*)::int n FROM release_versions')).rows[0].n).toBe(0);
 }finally{x.unblock();await running;x.restore();}
});

it('真实HTTP客户端断开会取消同次Git读取，迟到来源不能写入release',async()=>{
 const x=await pendingSource(),app=express();app.use(express.json());app.use('/releases',createReleasesRouter({pool:f.db}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const req=httpRequest({host:'127.0.0.1',port:server.address().port,path:'/releases',method:'POST',headers:{'Content-Type':'application/json'}});
 req.on('error',()=>{});req.end(JSON.stringify(x.input));
 try{
  const options=await x.started;expect(options.signal.aborted).toBe(false);req.destroy();
  for(let i=0;i<50&&!options.signal.aborted;i++)await wait(10);
  expect(options.signal.aborted).toBe(true);x.unblock();await wait(30);
  expect((await f.db.query('SELECT count(*)::int n FROM release_versions')).rows[0].n).toBe(0);
  const writer=await f.db.connect();try{await writer.query("SET statement_timeout='300ms'");await writer.query('UPDATE warehouse_items SET name=name');}finally{await writer.query('RESET statement_timeout');writer.release();}
 }finally{req.destroy();x.unblock();await wait(20);x.restore();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
it('真实PG同key并发在线proof完成后仅一条release，重放无需重新联网',async()=>{
 const x=await pendingSource(),first=outcome(createRelease(f.db,x.input)),second=outcome(createRelease(f.db,x.input));
 try{
  await x.started;x.unblock();const results=await Promise.all([first,second]);
  expect(results.every(r=>!r.error),results.map(r=>r.error)).toBe(true);
  expect(new Set(results.map(r=>r.value.release.id)).size).toBe(1);
  expect(results.filter(r=>r.value.created)).toHaveLength(1);
  const noNetwork=vi.spyOn(fixedGit,'readFixedGitFile').mockRejectedValue(Error('must not read again'));
  try{expect((await createRelease(f.db,x.input)).created).toBe(false);}finally{noNetwork.mockRestore();}
  expect((await f.db.query('SELECT count(*)::int n FROM release_versions')).rows[0].n).toBe(1);
  await expect(createRelease(f.db,{...x.input,actor:'different'})).rejects.toMatchObject({code:'RELEASE_CONFLICT'});
 }finally{x.unblock();await Promise.all([first,second]);x.restore();}
});
it('真实PG实现绑定在锁外核验期间改变不能写入旧proof',async()=>{
 const x=await pendingSource(),running=outcome(createRelease(f.db,x.input));
 try{
  await x.started;await f.db.query("UPDATE warehouse_items SET impl_ref='changed/unverified.js' WHERE id=$1",[f.enabler]);
  x.unblock();expect((await running).error).toMatchObject({code:'RELEASE_REGISTRATION_CHANGED'});
  expect((await f.db.query('SELECT count(*)::int n FROM release_versions')).rows[0].n).toBe(0);
 }finally{x.unblock();await running;x.restore();}
});
it.each(['cancel','timeout'])('真实PG写入临界区等待同key锁时%s不会遗留等待事务',async mode=>{
 const input={...f.releaseInput,release_key:'db-lock-'+randomUUID()},holder=await f.db.connect();
 const controller=new AbortController();let running;
 try{
  await holder.query('BEGIN');await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['release:'+input.release_key]);
  running=outcome(createRelease(f.db,input,{signal:controller.signal,timeoutMs:3000}));
  let waiting=0;
  for(let i=0;i<50&&!waiting;i++){
   waiting=(await f.db.query('SELECT count(*)::int n FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',[holder.processID])).rows[0].n;
   if(!waiting)await wait(10);
  }
  expect(waiting).toBe(1);if(mode==='cancel')controller.abort();
  const result=await Promise.race([running,wait(1800).then(()=>({stillPending:true}))]);
  expect(result.stillPending).toBeUndefined();expect(result.error).toBeTruthy();
  if(mode==='cancel')expect(result.error.code).toBe('RELEASE_REQUEST_ABORTED');else expect(result.error.code).toBe('RELEASE_TRANSACTION_TIMEOUT');
  // TCP断开不是PG cancel协议；服务端lock_timeout必须在1秒内终止遗留等待。
  let remaining=1;for(let i=0;i<150&&remaining;i++){
   remaining=(await f.db.query('SELECT count(*)::int n FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',[holder.processID])).rows[0].n;
   if(remaining)await wait(10);
  }
  expect(remaining).toBe(0);
  expect((await f.db.query('SELECT count(*)::int n FROM release_versions')).rows[0].n).toBe(0);
 }finally{controller.abort();await holder.query('ROLLBACK');holder.release();await running;}
});
it('真实PG连接池等待也受整体预算约束，迟到连接归还且无release',async()=>{
 const clients=await Promise.all(Array.from({length:6},()=>f.db.connect()));
 try{
  const result=await outcome(createRelease(f.db,f.releaseInput,{timeoutMs:60}));
  expect(result.error).toMatchObject({code:'RELEASE_VALIDATION_TIMEOUT'});
 }finally{for(const client of clients)client.release();}
 await wait(30);expect(f.db.waitingCount).toBe(0);expect(f.db.idleCount).toBe(f.db.totalCount);
 expect((await f.db.query('SELECT count(*)::int n FROM release_versions')).rows[0].n).toBe(0);
});

it.each(['cancel','write-error'])('真实PG INSERT后提交前%s必须回滚整条release',async mode=>{
 const controller=new AbortController();let inserted=false;
 const pool={connect:async()=>{
  const client=await f.db.connect();
  return {release:destroy=>client.release(destroy),on:(...args)=>client.on(...args),off:(...args)=>client.off(...args),query:async(sql,args)=>{
   const result=await client.query(sql,args);
   if(sql.startsWith('INSERT INTO release_versions')){
    inserted=true;if(mode==='cancel')controller.abort();else throw Error('injected-after-real-insert');
   }
   return result;
  }};
 }};
 const result=await outcome(createRelease(pool,f.releaseInput,{signal:controller.signal}));
 expect(inserted).toBe(true);expect(result.error).toBeTruthy();
 if(mode==='cancel')expect(result.error.code).toBe('RELEASE_REQUEST_ABORTED');else expect(result.error.message).toBe('injected-after-real-insert');
 await wait(30);expect((await f.db.query('SELECT count(*)::int n FROM release_versions')).rows[0].n).toBe(0);
});
