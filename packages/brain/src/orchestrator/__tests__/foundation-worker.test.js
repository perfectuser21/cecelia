import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {afterEach,expect,test,vi} from 'vitest';
import {prepareFoundationJob} from '../../../scripts/commander-workflow/foundation-worker-bundle.mjs';
import {runFoundationWorkerOnce,readWorkerConfig,createFoundationRequest} from '../../../scripts/commander-workflow/foundation-worker.mjs';
import {parseFoundationProfile,preparedFoundationRun} from '../../workflow-foundation/contracts.js';
const roots=[];const hash=data=>createHash('sha256').update(data).digest('hex');
function fixture(){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'foundation-worker-')));roots.push(root);
 const config={schema_version:1,brain_url:'http://127.0.0.1:5222',machine_id:'fixture-host',bundle_root:path.join(root,'bundles'),state_root:path.join(root,'states')};
 fs.mkdirSync(config.bundle_root,{mode:0o700});fs.mkdirSync(config.state_root,{mode:0o700});
 const repo='test/workflow',revision='a'.repeat(40),installed=path.join(config.bundle_root,repo,revision);fs.mkdirSync(installed,{recursive:true,mode:0o700});
 const sources={'adapter.mjs':'export function createRuntime(){throw Error("not executed in unit test")}', 'work.mjs':'process.exit(0)'};
 const files=Object.fromEntries(Object.entries(sources).map(([name,bytes])=>{fs.writeFileSync(path.join(installed,name),bytes);return [name,hash(bytes)];}));
 const contract={workflow:'sample',goal:'交出真实产物',activities:[{key:'work',order:1,budget:{max_duration_s:10,heartbeat_s:1},acceptance:{description:'读回产物'},failure:{empty_ok:[],retryable:[],fatal:['error'],needs_human:{cases:['unknown']}},runtime:{phase:'source',protocol:'json-stdio-v1',entry:'work.mjs',executor_kind:'code'}}]};
 const text=JSON.stringify({schema_version:1,contract,profile:{adapter:'adapter.mjs',files,commander:{provider:'adapter'}}});fs.writeFileSync(path.join(installed,'profile.json'),text);
 const workflowId=randomUUID(),versionId=randomUUID(),taskId=randomUUID(),runId=randomUUID();
 const runtime={kind:'commander-foundation-v1',profile_ref:{repo,path:'profile.json',revision,digest:'sha256:'+hash(text)},timeout_ms:30000,input_schema:{type:'object'}};
 const definition={workflow_id:workflowId,workflow_definition_version_id:versionId,snapshot_sha256:'b'.repeat(64)};
 const components=[{kind:'repo',repo,revision},...Object.entries({...sources,'profile.json':text}).map(([file,bytes])=>({kind:'code',repo,revision,path:file,digest:'sha256:'+hash(bytes)}))];
 const release={id:randomUUID(),target:config.machine_id+'/sample',payload:{components,workflows:[{id:versionId,workflow_id:workflowId,payload_sha256:definition.snapshot_sha256,payload:{contract:{key:'sample'},activities:[{slot_key:'work'}]}}]}};
 const job={task_id:taskId,run_id:runId,machine_id:config.machine_id,runtime,definition,release,input:{run_tag:runId,value:21},deadline_ms:Date.now()+30000};
 return {root,config,job,installed,text};
}
afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
test('发布方法原文进入Worker冻结清单，与服务端ready重建完全一致且恢复拒绝换方法',()=>{
 const f=fixture(),doc=JSON.parse(f.text),playbook={schema_version:1,content:'仅交付本流程的报告。\r\n按合同验收。'};
 function publish(value){doc.playbook=value;const text=JSON.stringify(doc);fs.writeFileSync(path.join(f.installed,'profile.json'),text);f.job.runtime.profile_ref.digest='sha256:'+hash(text);f.job.release.payload.components.find(c=>c.path==='profile.json').digest=f.job.runtime.profile_ref.digest;return text;}
 const text=publish(playbook),p=prepareFoundationJob(f.job,f.config);
 const serverDoc=parseFoundationProfile(text,f.job.runtime,f.job.release,f.job.release.payload.workflows[0]);
 const serverRun=preparedFoundationRun(f.job,serverDoc.contract,p.readyBody.runtime_revision,serverDoc.playbook);
 expect(serverRun).toEqual(p.manifest.run);expect(serverRun.playbook).toEqual(playbook);expect(p.readyBody.definition_sha256).toBe(serverRun.definition_sha256);
 expect(prepareFoundationJob(f.job,f.config).manifest).toEqual(p.manifest);
 publish({...playbook,content:'换了方法'});expect(()=>prepareFoundationJob(f.job,f.config)).toThrow('foundation_worker_immutable_conflict');
});
test('发布包复制到每run独立目录，身份与截止时间由Brain固定',()=>{
 const f=fixture(),p=prepareFoundationJob(f.job,f.config);
 expect(p.manifest.run.task_id).toBe(f.job.task_id);expect(p.manifest.run.run_id).toBe(f.job.run_id);expect(p.manifest.run.deadline_ms).toBe(f.job.deadline_ms);
 expect(p.manifest.profile.cwd).toBe(path.join(f.config.state_root,f.job.run_id,'bundle'));
 expect(fs.readFileSync(path.join(p.manifest.profile.cwd,'work.mjs'),'utf8')).toBe('process.exit(0)');
 expect(p.readyBody.profile_document).toBe(f.text);expect(p.readyBody.definition_sha256).toMatch(/^[a-f0-9]{64}$/);
 const nextId=randomUUID(),other=prepareFoundationJob({...f.job,run_id:nextId,input:{run_tag:nextId}},f.config);expect(other.manifest.profile.cwd).not.toBe(p.manifest.profile.cwd);
});
test('恢复保持同manifest和业务产物；输入、deadline变化拒绝',()=>{
 const f=fixture(),first=prepareFoundationJob(f.job,f.config);fs.writeFileSync(path.join(first.manifest.profile.cwd,'output.json'),'original');
 expect(prepareFoundationJob(f.job,f.config).manifest).toEqual(first.manifest);expect(fs.readFileSync(path.join(first.manifest.profile.cwd,'output.json'),'utf8')).toBe('original');
 expect(()=>prepareFoundationJob({...f.job,input:{...f.job.input,value:22}},f.config)).toThrow(/immutable|conflict/);
 expect(()=>prepareFoundationJob({...f.job,deadline_ms:f.job.deadline_ms+1},f.config)).toThrow(/immutable|conflict/);
});
test('恢复不覆盖漂移代码，不补回缺失的冻结文件',()=>{
 const f=fixture(),p=prepareFoundationJob(f.job,f.config),work=path.join(p.manifest.profile.cwd,'work.mjs');fs.writeFileSync(work,'changed');
 expect(()=>prepareFoundationJob(f.job,f.config)).toThrow(/drift/);fs.unlinkSync(work);expect(()=>prepareFoundationJob(f.job,f.config)).toThrow(/missing/);
});
test('来源漂移、未发布组件、错误profile摘要均不生成manifest',()=>{
 for(const change of [f=>fs.writeFileSync(path.join(f.installed,'work.mjs'),'bad'),f=>f.job.release.payload.components.pop(),f=>f.job.runtime.profile_ref.digest='sha256:'+'c'.repeat(64)]){
  const f=fixture();change(f);expect(()=>prepareFoundationJob(f.job,f.config)).toThrow();expect(fs.existsSync(path.join(f.config.state_root,f.job.run_id,'manifest.json'))).toBe(false);
 }
});
test('拒绝路径逃逸、跨目录软链接和异机任务',()=>{
 const f=fixture();expect(()=>prepareFoundationJob({...f.job,machine_id:'other'},f.config)).toThrow(/machine/);f.job.runtime.profile_ref.path='../profile.json';expect(()=>prepareFoundationJob(f.job,f.config)).toThrow(/path/);
 const g=fixture();fs.unlinkSync(path.join(g.installed,'work.mjs'));fs.writeFileSync(path.join(g.root,'outside.mjs'),'process.exit(0)');fs.symlinkSync(path.join(g.root,'outside.mjs'),path.join(g.installed,'work.mjs'));expect(()=>prepareFoundationJob(g.job,g.config)).toThrow(/path|symlink/);
});
test('ready拒绝不执行；本地伪造成功文件不成为中央回执',async()=>{
 const f=fixture(),launch=vi.fn(),rejected=vi.fn(async route=>route==='/claim'?{job:f.job}:Promise.reject(Error('ready_rejected')));
 await expect(runFoundationWorkerOnce(f.config,{request:rejected,launch})).rejects.toThrow('ready_rejected');expect(launch).not.toHaveBeenCalled();
 const calls=[],request=async(route,body)=>{calls.push({route,body});if(route==='/claim')return {job:f.job};if(route.endsWith('/ready'))return {run:prepareFoundationJob(f.job,f.config).manifest.run};return {status:'blocked',task_id:f.job.task_id,run_id:f.job.run_id};};
 const result=await runFoundationWorkerOnce(f.config,{request,launch:async p=>{fs.writeFileSync(p.resultPath,'{"status":"completed"}');return {code:0};}});
 expect(result.status).toBe('blocked');expect(calls.at(-1).body).toEqual({machine_id:f.config.machine_id,run_id:f.job.run_id});
});
test('空队列不启动；启动异常仍请求server读回',async()=>{
 const f=fixture(),launch=vi.fn();expect(await runFoundationWorkerOnce(f.config,{request:async()=>({job:null}),launch})).toEqual({status:'idle'});expect(launch).not.toHaveBeenCalled();
 const request=vi.fn(async route=>route==='/claim'?{job:f.job}:route.endsWith('/ready')?{run:prepareFoundationJob(f.job,f.config).manifest.run}:{status:'in_progress',task_id:f.job.task_id,run_id:f.job.run_id});
 await expect(runFoundationWorkerOnce(f.config,{request,launch:async()=>{throw Error('spawn_failed');}})).rejects.toThrow('spawn_failed');expect(request.mock.calls.at(-1)[0]).toMatch(/reconcile$/);
});
test('配置拒绝远程明文URL、他人可写文件和任意command',()=>{
 const f=fixture(),file=path.join(f.root,'worker.json');fs.writeFileSync(file,JSON.stringify(f.config),{mode:0o600});expect(readWorkerConfig(file)).toMatchObject(f.config);
 fs.chmodSync(file,0o666);expect(()=>readWorkerConfig(file)).toThrow(/config/);fs.chmodSync(file,0o600);
 fs.writeFileSync(file,JSON.stringify({...f.config,brain_url:'http://example.com'}));expect(()=>readWorkerConfig(file)).toThrow(/url/);
 fs.writeFileSync(file,JSON.stringify({...f.config,command:'sh'}));expect(()=>readWorkerConfig(file)).toThrow(/config/);
});

test('源码预检失败回写明确原因且不启动；已ready任务由服务端保留blocked',async()=>{
 for(const status of ['failed','blocked']){
  const f=fixture();fs.writeFileSync(path.join(f.installed,'work.mjs'),'drift');const launch=vi.fn(),calls=[];
  const request=async(route,body)=>{calls.push({route,body});return route==='/claim'?{job:f.job}:{task_id:f.job.task_id,run_id:f.job.run_id,status};};
  expect((await runFoundationWorkerOnce(f.config,{request,launch})).status).toBe(status);expect(launch).not.toHaveBeenCalled();
  expect(calls.at(-1)).toEqual({route:`/tasks/${f.job.task_id}/preflight-failed`,body:{machine_id:f.config.machine_id,run_id:f.job.run_id,reason_code:'foundation_worker_source_drift'}});
 }
});

test('即使源码声明已冻结，profile也不能携带本机路径或凭据权限',()=>{
 for(const bad of [{cwd:'/tmp/untrusted'},{env:{CECELIA_INTERNAL_TOKEN:'forbidden'}},{skill_runtime:{codex:{command:'/bin/sh'}}}]){
  const f=fixture(),doc=JSON.parse(f.text);Object.assign(doc.profile,bad);const bytes=JSON.stringify(doc);
  fs.writeFileSync(path.join(f.installed,'profile.json'),bytes);f.job.runtime.profile_ref.digest='sha256:'+hash(bytes);
  f.job.release.payload.components.find(c=>c.path==='profile.json').digest=f.job.runtime.profile_ref.digest;
  expect(()=>prepareFoundationJob(f.job,f.config)).toThrow(/profile_authority|profile_command/);
 }
});

test('Commander调用时限随固定runtime进入run哈希，不能退回默认值',()=>{
 const f=fixture();f.job.runtime.commander_timeout_ms=2345;const p=prepareFoundationJob(f.job,f.config);
 expect(p.manifest.run.commander_timeout_ms).toBe(2345);
 expect(()=>prepareFoundationJob({...f.job,runtime:{...f.job.runtime,commander_timeout_ms:3456}},f.config)).toThrow(/immutable|conflict/);
});

 test('ready明确拒绝收账：过期未授权失败，已授权冲突只采纳服务端blocked',async()=>{
 for(const [code,status] of [['foundation_deadline_exceeded','failed'],['foundation_manifest_identity_conflict','blocked'],['foundation_profile_paths_invalid','failed']]){
  const f=fixture(),launch=vi.fn(),calls=[];
  const request=createFoundationRequest(f.config,{env:{CECELIA_INTERNAL_TOKEN:'test-only'},fetchFn:async(url,options)=>{
   const route=url.pathname,body=JSON.parse(options.body);calls.push({route,body});
   if(route.endsWith('/claim'))return new Response(JSON.stringify({job:f.job}),{status:200});
   if(route.endsWith('/ready'))return new Response(JSON.stringify({error:code}),{status:code.endsWith('_invalid')?400:409});
   return new Response(JSON.stringify({task_id:f.job.task_id,run_id:f.job.run_id,status}),{status:200});
  }});
  expect((await runFoundationWorkerOnce(f.config,{request,launch})).status).toBe(status);expect(launch).not.toHaveBeenCalled();
  expect(calls.at(-1)).toEqual({route:`/api/brain/workflow-foundation/tasks/${f.job.task_id}/preflight-failed`,body:{machine_id:f.config.machine_id,run_id:f.job.run_id,reason_code:code}});
 }
});
 test('ready网络、5xx、鉴权与未知错误不声明预检失败',async()=>{
 for(const failure of [Error('network_unknown'),Object.assign(Error('foundation_deadline_exceeded'),{status:500}),Object.assign(Error('unauthorized'),{status:401}),Object.assign(Error('unexpected'),{status:409})]){
  const f=fixture(),launch=vi.fn(),calls=[];const request=async route=>{calls.push(route);if(route==='/claim')return {job:f.job};throw failure;};
  await expect(runFoundationWorkerOnce(f.config,{request,launch})).rejects.toThrow(failure.message);expect(launch).not.toHaveBeenCalled();expect(calls).toHaveLength(2);
 }
});
