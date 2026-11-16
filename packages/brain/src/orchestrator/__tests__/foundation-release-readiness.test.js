import {afterEach,describe,it,expect,vi} from 'vitest';
import fs from 'node:fs';
import {prepareDefinitionFreeze,assertPreparedFreeze} from '../../workflow-authoring/freeze.js';
import {validateDefinition} from '../../workflow-authoring/registration.js';
import {compileAssemblyPlan} from '../../workflow-authoring/assembly-plan.js';
import {validateFoundationInput} from '../../workflow-foundation/contracts.js';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {runReport} from '../../../scripts/commander-workflow/operations/release-readiness/report.mjs';
import {runCleanup} from '../../../scripts/commander-workflow/operations/release-readiness/cleanup.mjs';
import {checkRequest} from '../../../scripts/commander-workflow/operations/release-readiness/checker.mjs';
import {createRuntime,withReadinessIdentity} from '../../../scripts/commander-workflow/operations/release-readiness/adapter.mjs';
import {verifySkillReadback} from '../../../scripts/commander-workflow/skill-protocol.mjs';
import {parseFoundationProfile} from '../../workflow-foundation/contracts.js';
import {parseActivityContract,parseActivityResult} from '../activity-contract.js';
const hash=x=>createHash('sha256').update(x).digest('hex');
const dirs=[];
function fixture(){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'foundation-readiness-')));dirs.push(root);
 const taskId=randomUUID(),runId=randomUUID(),sha='a'.repeat(40),version='1.445.234';
 const input={run_tag:runId,expected_brain_sha:sha,expected_brain_version:version,action_id:'b'.repeat(64),_readiness:{root,task_id:taskId,run_id:runId}};
 const body={health:{status:'healthy',git_sha:sha,version,runtime:{isolated:false}},version:{version},task:{id:taskId,status:'in_progress',task_type:'workflow_dispatch',payload:{commander_protocol:'commander-foundation-v1'},result:{foundation_runner:{task_id:taskId,run_id:runId}},private_payload:'must-not-be-saved'}};
 const fetchFn=vi.fn(async(url,options)=>{expect(options.redirect).toBe('error');const key=url.endsWith('/health')?'health':url.endsWith('/version')?'version':'task';return new Response(JSON.stringify(body[key]),{status:200,headers:{'content-type':'application/json'}});});
 const file=name=>path.join(root,'readiness-evidence',name);
 const request=(activity,phase,proposal)=>({task_id:taskId,run_id:runId,run_tag:runId,workflow:'foundation_release_readiness',activity,attempt:1,nonce:randomUUID(),phase,checks:phase==='start'?['input_identity','resource_owned']:activity==='report'?['report_content','single_effect']:['resource_released','evidence_preserved'],proposal,context:input});
 return {root,input,body,fetchFn,file,request};
}
afterEach(()=>{vi.unstubAllEnvs();for(const d of dirs.splice(0))fs.rmSync(d,{recursive:true,force:true});});
describe('Foundation真实发布就绪报告',()=>{
 it('采集实际API响应、按原Task/Run存证，独立检查后只释放本run资源',async()=>{
  const f=fixture();
  const start=f.request('report','start');expect(verifySkillReadback(checkRequest(start),start).outcome).toBe('passed');
  const result=await runReport(f.input,{fetchFn:f.fetchFn});expect(parseActivityResult(result,f.input).status).toBe('completed');expect(f.fetchFn).toHaveBeenCalledTimes(3);
  expect(f.fetchFn.mock.calls.map(c=>c[0])).toEqual(['http://127.0.0.1:5221/api/brain/health','http://127.0.0.1:5221/api/brain/version',`http://127.0.0.1:5221/api/brain/tasks/${f.input._readiness.task_id}`]);
  expect(fs.readFileSync(f.file('snapshot.json'),'utf8')).not.toContain('must-not-be-saved');
  const end=f.request('report','end',result);expect(verifySkillReadback(checkRequest(end),end).output).toEqual(result.outputs);
  const before=fs.readFileSync(f.file('report.json'));const cleanup=runCleanup({...f.input,action_id:'c'.repeat(64)});
  expect(parseActivityResult(cleanup,f.input).status).toBe('completed');expect(fs.existsSync(f.file('lease.json'))).toBe(false);expect(fs.readFileSync(f.file('report.json'))).toEqual(before);
  const cleanupEnd={...f.request('cleanup','end',cleanup),context:{...f.input,action_id:'c'.repeat(64)}};expect(verifySkillReadback(checkRequest(cleanupEnd),cleanupEnd).output).toEqual(cleanup.outputs);
 });
 it('错误SHA、版本或Task/Run身份不会产出成功报告',async()=>{
  for(const mutate of [f=>f.body.health.git_sha='d'.repeat(40),f=>f.body.version.version='9.9.9',f=>f.body.task.result.foundation_runner.run_id=randomUUID(),f=>f.body.health.status='unhealthy']){
   const f=fixture();mutate(f);await expect(runReport(f.input,{fetchFn:f.fetchFn})).rejects.toThrow(/readiness_(brain|task)_/);expect(fs.existsSync(f.file('report.json'))).toBe(false);
  }
 });
 it('已提交报告恢复只读同一产物，不重复请求或追加动作；不完整动作拒绝重跑',async()=>{
  const f=fixture();const a=await runReport(f.input,{fetchFn:f.fetchFn});const before=fs.readFileSync(f.file('report.json'));
  const b=await runReport(f.input,{fetchFn:f.fetchFn});expect(b).toEqual(a);expect(f.fetchFn).toHaveBeenCalledTimes(3);expect(fs.readFileSync(f.file('report.json'))).toEqual(before);
  const failed=fixture();failed.fetchFn.mockRejectedValue(Error('offline'));await expect(runReport(failed.input,{fetchFn:failed.fetchFn})).rejects.toThrow('offline');const calls=failed.fetchFn.mock.calls.length;
  await expect(runReport(failed.input,{fetchFn:failed.fetchFn})).rejects.toThrow('readiness_report_incomplete');expect(failed.fetchFn).toHaveBeenCalledTimes(calls);
 });
 it('独立检查拒绝报告篡改、重复动作计数与伪造成功结果',async()=>{
  for(const corrupt of [f=>{const p=JSON.parse(fs.readFileSync(f.file('report.json')));p.brain_sha='d'.repeat(40);fs.writeFileSync(f.file('report.json'),JSON.stringify(p));},f=>{const p=JSON.parse(fs.readFileSync(f.file('effect.json')));p.count=2;fs.writeFileSync(f.file('effect.json'),JSON.stringify(p));}]){
   const f=fixture();const result=await runReport(f.input,{fetchFn:f.fetchFn});corrupt(f);expect(()=>checkRequest(f.request('report','end',result))).toThrow(/readiness_/);
  }
  const f=fixture();const result=await runReport(f.input,{fetchFn:f.fetchFn});result.outputs.report_sha256='f'.repeat(64);expect(()=>checkRequest(f.request('report','end',result))).toThrow('readiness_result_mismatch');
 });
 it('外来run占位不会被报告复用或cleanup删除',async()=>{
  const f=fixture();await runReport(f.input,{fetchFn:f.fetchFn});const lease=JSON.parse(fs.readFileSync(f.file('lease.json')));lease.run_id=randomUUID();fs.writeFileSync(f.file('lease.json'),JSON.stringify(lease));const before=fs.readFileSync(f.file('lease.json'));
  expect(()=>runCleanup({...f.input,action_id:'c'.repeat(64)})).toThrow('readiness_owner_conflict');expect(fs.readFileSync(f.file('lease.json'))).toEqual(before);expect(()=>checkRequest(f.request('cleanup','start'))).toThrow('readiness_owner_conflict');
 });
 it('同run的动作身份冲突和符号链接证据被拒绝',async()=>{
  const f=fixture();await runReport(f.input,{fetchFn:f.fetchFn});await expect(runReport({...f.input,action_id:'d'.repeat(64)},{fetchFn:f.fetchFn})).rejects.toThrow('readiness_owner_conflict');
  const outside=path.join(f.root,'outside.json');fs.writeFileSync(outside,'{}');fs.unlinkSync(f.file('report.json'));fs.symlinkSync(outside,f.file('report.json'));expect(()=>checkRequest(f.request('report','end'))).toThrow('readiness_evidence_invalid');
 });
 it('报告失败时cleanup只归位本run资源，重复cleanup不重复写效果',async()=>{
  const f=fixture();f.body.health.git_sha='d'.repeat(40);await expect(runReport(f.input,{fetchFn:f.fetchFn})).rejects.toThrow('readiness_brain_mismatch');
  const input={...f.input,action_id:'c'.repeat(64)},result=runCleanup(input),before=fs.readFileSync(f.file('cleanup.json'));
  expect(result.outputs.report_present).toBe(false);expect(runCleanup(input)).toEqual(result);expect(fs.readFileSync(f.file('cleanup.json'))).toEqual(before);expect(fs.existsSync(f.file('lease.json'))).toBe(false);
 });
 it('adapter以受信run和cwd覆盖调用者伪造身份并装载现行监督实现',async()=>{
  const f=fixture(),run={task_id:f.input._readiness.task_id,run_id:f.input._readiness.run_id,input:{run_tag:f.input.run_tag,expected_brain_sha:f.input.expected_brain_sha,expected_brain_version:f.input.expected_brain_version}};
  const profile={cwd:f.root,runtimeRoot:fileURLToPath(new URL('../../../',import.meta.url)),files:{},skill_runtime:{control_dir:'control',activities:{}}};
  const input=withReadinessIdentity({_readiness:{root:'/foreign',task_id:randomUUID(),run_id:randomUUID()},expected_brain_sha:'f'.repeat(40)},run,profile);
  expect(input._readiness).toEqual(f.input._readiness);expect(input.expected_brain_sha).toBe(f.input.expected_brain_sha);expect(input.run_tag).toBe(f.input.run_tag);
  const runtime=await createRuntime({profile,run});expect(['executeActivity','inspectActivity','checkActivity'].every(k=>typeof runtime[k]==='function')).toBe(true);
 });
 it('独立QA任务与派单任务均读取真实Task，缺失占位不能冒充完整报告',async()=>{
  const f=fixture();f.body.task={id:f.input._readiness.task_id,status:'in_progress',task_type:'qa'};const value=await runReport(f.input,{fetchFn:f.fetchFn});expect(checkRequest(f.request('report','end',value)).outcome).toBe('passed');
  fs.unlinkSync(f.file('reservation.json'));expect(()=>checkRequest(f.request('report','end',value))).toThrow('readiness_evidence_missing');
 });
 it('真实CLI失败经监督器和adapter明确停止，finalize可以清理原占位',async()=>{
  const f=fixture(),repo=fileURLToPath(new URL('../../../../../',import.meta.url)),folder='packages/brain/scripts/commander-workflow/operations/release-readiness';
  const doc=JSON.parse(fs.readFileSync(path.join(repo,folder,'profile.json'))),profile={...doc.profile,cwd:f.root,runtimeRoot:path.join(repo,'packages/brain')};
  for(const entry of Object.keys(profile.files)){fs.mkdirSync(path.dirname(path.join(f.root,entry)),{recursive:true});fs.copyFileSync(path.join(repo,entry),path.join(f.root,entry));}
  for(const activity of Object.values(profile.skill_runtime.activities))Object.assign(activity.checker,{command:process.execPath,command_sha256:hash(fs.readFileSync(process.execPath))});
  const preload=path.join(f.root,'network-boundary.mjs');fs.writeFileSync(preload,"globalThis.fetch=async()=>{throw Error('offline-test-boundary');};\n");vi.stubEnv('NODE_OPTIONS','--import='+preload);
  const run={task_id:f.input._readiness.task_id,run_id:f.input._readiness.run_id,input:f.input,contract:doc.contract},runtime=await createRuntime({profile,run});
  const options=key=>({identity:{task_id:run.task_id,run_id:run.run_id,activity_key:key,action_id:key==='report'?f.input.action_id:'c'.repeat(64)},cwd:f.root,deadlineMs:Date.now()+10000});
  const failed=await runtime.executeActivity(doc.contract.activities[0],f.input,options('report'));
  expect(failed.status).toBe('failed');expect(failed.failure_class).toBe('fatal');expect(failed.execution_stopped).toBe(true);expect(failed.external_effect).not.toBe('unknown');
  const cleanupInput={...f.input,action_id:'c'.repeat(64)},cleaned=await runtime.executeActivity(doc.contract.activities[1],cleanupInput,options('cleanup'));
  expect(cleaned.status).toBe('completed');expect((await runtime.checkActivity(doc.contract.activities[1],cleaned,{phase:'end',input:cleanupInput})).verdict).toBe('pass');expect(fs.existsSync(f.file('lease.json'))).toBe(false);
 },15000);
 it('源码profile冻结真实文件，Code活动与独立checker保持同一契约',()=>{
  const repo=fileURLToPath(new URL('../../../../../',import.meta.url)),folder='packages/brain/scripts/commander-workflow/operations/release-readiness';const doc=JSON.parse(fs.readFileSync(path.join(repo,folder,'profile.json')));
  const source=fs.readFileSync(path.join(repo,folder,'profile.json'),'utf8'),ref={repo:'owner/repo',path:folder+'/profile.json',revision:'a'.repeat(40),digest:'sha256:'+hash(source)};
  const components=[{kind:'code',...ref},...Object.entries(doc.profile.files).map(([entry,digest])=>({kind:'code',repo:ref.repo,path:entry,revision:ref.revision,digest:'sha256:'+digest}))];
  expect(parseFoundationProfile(source,{profile_ref:ref},{payload:{components}},{payload:{key:'foundation_release_readiness',activities:[{slot_key:'report'},{slot_key:'cleanup'}]}}).schema_version).toBe(1);
  const contract=parseActivityContract(doc.contract);expect(contract.workflow).toBe('foundation_release_readiness');expect(contract.activities.map(a=>[a.key,a.runtime.phase,a.runtime.executor_kind,a.runtime.max_attempts])).toEqual([['report','source','code',1],['cleanup','finalize','code',1]]);
  expect(doc.profile.commander.provider).toBe('codex');expect(doc.playbook.content).toContain('report');expect(doc.playbook.content).toContain('cleanup');
  for(const [entry,digest] of Object.entries(doc.profile.files)){expect(entry.startsWith(folder+'/')).toBe(true);expect(hash(fs.readFileSync(path.join(repo,entry)))).toBe(digest);}
  for(const a of contract.activities){expect(doc.profile.files[a.runtime.entry]).toBeDefined();expect(doc.profile.skill_runtime.activities[a.key].checker.command).toBe('@node');}
  expect(doc.profile.cwd).toBeUndefined();expect(doc.profile.env).toBeUndefined();expect(doc.profile.codex_auth).toBeUndefined();
 });
});

describe('真实注册定义与固定Git执行包',()=>{
 const repoRoot=fileURLToPath(new URL('../../../../../',import.meta.url)),folder='packages/brain/scripts/commander-workflow/operations/release-readiness',revision='84a75cf8ae537951c8411aff096e31cbf1d507de';
 const load=()=>JSON.parse(fs.readFileSync(path.join(repoRoot,folder,'workflow.json')));
 const source={repo:'perfectuser21/cecelia',ref:folder+'/workflow.json',revision:'e'.repeat(40)};
 // 只替换Git传输边界；冻结器继续核验固定revision和实际源码digest，不生成生产证明。
 const gitRead=s=>{expect(s.repo).toBe(source.repo);expect(s.revision).toBe(revision);return fs.readFileSync(path.join(repoRoot,s.path),'utf8');};
 it('注册、装配、冻结与profile解析读取同一固定执行包，源文件不自引用',async()=>{
  const document=load(),definition={...document,source};expect(document.source).toBeUndefined();expect(validateDefinition(definition)).toBe(true);expect(compileAssemblyPlan(definition).structurally_complete).toBe(true);
  expect(definition.runtime).toMatchObject({kind:'commander-foundation-v1',timeout_ms:300000,cleanup_timeout_ms:120000,commander_timeout_ms:90000});
  expect(definition.capability_id).toBe('2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6');expect(definition.activities.map(a=>a.key)).toEqual(['report','cleanup']);
  const readFile=vi.fn(async s=>{if(s.path===source.ref){expect(s.revision).toBe(source.revision);return JSON.stringify(document);}expect(s.repo).toBe(source.repo);expect(s.revision).toBe(revision);return gitRead(s);});
  const proof=await prepareDefinitionFreeze(definition,{readFile});expect(()=>assertPreparedFreeze(definition,proof)).not.toThrow();
  const components=[...proof.bindings.values()].flat();expect(components.every(c=>c.status==='verified')).toBe(true);
  const profile=gitRead(definition.runtime.profile_ref),parsed=parseFoundationProfile(profile,definition.runtime,{payload:{components}},{payload:{contract:definition,activities:definition.activities.map(a=>({slot_key:a.key}))}});
  expect(new Set(components.map(c=>c.path))).toEqual(new Set([definition.runtime.profile_ref.path,...Object.keys(parsed.profile.files)]));
  for(const a of definition.activities){expect(a.steps).toHaveLength(1);expect(a.steps[0].dod.readback.type).toBe('file');expect(a.steps[0].implementation.revision).toBe(revision);}
  expect(()=>validateFoundationInput(definition.runtime,{expected_brain_sha:'a'.repeat(40),expected_brain_version:'1.445.234'})).not.toThrow();
  for(const input of [{expected_brain_sha:'main',expected_brain_version:'1.445.234'},{expected_brain_sha:'a'.repeat(40)},{expected_brain_sha:'a'.repeat(40),expected_brain_version:'1.445.234',_readiness:{root:'/foreign'}}])expect(()=>validateFoundationInput(definition.runtime,input)).toThrow();
 });
 it('被替换的固定实现与丢失Step读回均不能取得冻结证明',async()=>{
  const document=load(),definition={...document,source};
  await expect(prepareDefinitionFreeze(definition,{readFile:async s=>s.path===source.ref?JSON.stringify(document):gitRead(s)+'\n// tampered'})).rejects.toThrow(/digest/);
  delete document.activities[0].steps[0].dod.readback;
  await expect(prepareDefinitionFreeze({...document,source},{readFile:async s=>s.path===source.ref?JSON.stringify(document):gitRead(s)})).rejects.toThrow('step_readback_missing');
 });
});
