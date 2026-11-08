import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{runtimeConfigDigest,protectedFileDigest}=require('./runtime-config.cjs');
it('node配置摘要读取部署profile且不回写源码，私有文件字节与权限变化受检查',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'runtime-config-')),file=path.join(root,'profile.json');
 try{fs.writeFileSync(file,'{}',{mode:0o600});const a=protectedFileDigest(file);fs.writeFileSync(file,'{"capacity":8}');expect(protectedFileDigest(file)).not.toBe(a);fs.chmodSync(file,0o666);expect(()=>protectedFileDigest(file)).toThrow('worker_runtime_code_unprotected');expect(runtimeConfigDigest({machine_id:'xian-mac-m4'})).toMatch(/^[a-f0-9]{64}$/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
function isolated(work){
 const result=spawnSync(process.execPath,['-e',`(${work.toString()})().catch(error=>{console.error(error);process.exitCode=1;});`],{cwd:fileURLToPath(new URL('.',import.meta.url)),encoding:'utf8',timeout:15000});
 expect(result.status,result.stdout+'\n'+result.stderr).toBe(0);
}
it('未加载domain首次require不改变相同配置身份，使用独立进程避免测试预热掩盖回归',()=>isolated(async function(){
 const assert=require('node:assert/strict');require('./fleet-worker.cjs');require('./workflow-only-runtime.cjs');require('./workflow-runner.cjs');
 const {runtimeConfigDigest}=require('./runtime-config.cjs'),config=Object.freeze({workerId:'us-mac-m4'}),snapshot=JSON.stringify(config);
 assert.equal(require.cache[require.resolve('./workflow-domain.cjs')],undefined);
 const before=runtimeConfigDigest(config);require('./workflow-domain.cjs');
 assert.equal(JSON.stringify(config),snapshot);assert.equal(runtimeConfigDigest(config),before,'normal domain lazy-load changed worker config digest');
}));
it('未加载受保护代码库存新增删除及字节变化仍改变摘要，权限与符号链接仍拒绝',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'runtime-inventory-'));
 try{
  const entry=path.join(root,'runtime-config.cjs');fs.copyFileSync(fileURLToPath(new URL('./runtime-config.cjs',import.meta.url)),entry);
  fs.writeFileSync(path.join(root,'fleet-node-profiles.json'),'{}');
  const {runtimeConfigDigest:read}=require(entry),config={workerId:'fixture'};const before=read(config),cold=path.join(root,'cold.cjs');
  fs.writeFileSync(cold,'module.exports={version:1};');const added=read(config);expect(added).not.toBe(before);
  fs.writeFileSync(cold,'module.exports={version:2};');expect(read(config)).not.toBe(added);
  fs.chmodSync(cold,0o666);expect(()=>read(config)).toThrow('worker_runtime_code_unprotected');fs.chmodSync(cold,0o600);
  fs.unlinkSync(cold);expect(read(config)).toBe(before);
  const target=path.join(root,'target.txt');fs.writeFileSync(target,'module.exports={};');fs.symlinkSync(target,cold);expect(()=>read(config)).toThrow();
  fs.unlinkSync(cold);expect(read({...config,workerId:'changed'})).not.toBe(before);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
it('真实HTTP catalog到首次正常domain执行后inspect保持原pins，未改profile或配置',()=>isolated(async function(){
 const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID,createHash,createHmac}=require('node:crypto');
 const {createFleetWorkerServer}=require('./fleet-worker.cjs'),{createWorkflowRunner,profileDigest}=require('./workflow-runner.cjs'),{runtimeConfigDigest}=require('./runtime-config.cjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'runtime-domain-http-')),token='private-lifecycle-test-token-'.repeat(2),boot=randomUUID();let server,runner;
 try{
  const source=`import fs from 'node:fs';import path from 'node:path';export function createWorkflowDomain({profile}){fs.writeFileSync(path.join(profile.cwd,'domain-loaded'),'true');return {executeActivity:async(a,input)=>({schema_version:1,status:'completed',run_tag:input.run_tag,outputs:{answer:42},metrics:{},evidence:[{actual:true}]}),checkActivity:async(a,r,o)=>({verdict:'pass',acceptance_ref:o.acceptance.ref,evidence:[{actual:true}]}),validateWorkflow:async(p,r,o)=>({verdict:'pass',acceptance_ref:o.acceptance.ref,evidence:[{actual:true}]}),close:async()=>({execution_stopped:true})};}`;
  fs.writeFileSync(path.join(root,'domain.mjs'),source);
  const profile={cwd:root,files:{'domain.mjs':createHash('sha256').update(source).digest('hex')},domain_adapter:{protocol:'workflow-domain/v1',entry:'domain.mjs',export_name:'createWorkflowDomain',config:{},budget:{max_duration_s:5,cleanup_grace_s:1}},contract:{workflow:'test',activities:[{key:'work',order:1,budget:{max_duration_s:3,heartbeat_s:1},failure:{empty_ok:[],retryable:[],fatal:['error'],needs_human:{cases:[]}},runtime:{protocol:'json-stdio-v1',phase:'source',entry:'domain.mjs'}}]},metadata:{work:{activity_id:randomUUID(),executor_kind:'code',questions:{}}},validators:{workflow:{entry:'domain.mjs',acceptance:{ref:'workflow@1'}}}};
  const profiles={fixed:profile},config={surface:'workflow',workerId:'us-mac-m4',workflowProfiles:profiles},initial=JSON.stringify(config),digest=profileDigest(profile);
  runner=createWorkflowRunner({stateRoot:path.join(root,'state'),machineId:'us-mac-m4',profiles,assertCanLaunch:()=>{},assertLocalResources:async()=>{},createRecorder:()=>({onEvent:async()=>{},recordValidation:async()=>{},finalize:async()=>{},flush:async()=>({pending:0,blocked:0})})});
  server=createFleetWorkerServer({machineId:'us-mac-m4',attemptToken:token,workflowRunner:runner,workflowProfileCatalog:()=>digest,launchAdmission:{snapshot:()=>({boot_id:boot,activity_revision:0})},getRuntimeConfigDigest:()=>runtimeConfigDigest(config)});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}${route}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  assert.equal(require.cache[require.resolve('./workflow-domain.cjs')],undefined);
  const catalog=await call('/workflows/profile-catalog',{request_nonce:randomUUID(),profile_id:'fixed'});assert.equal(catalog.status,200);
  assert.equal(createHmac('sha256',token).update(JSON.stringify(catalog.body.receipt)).digest('hex'),catalog.body.signature);
  const run=randomUUID(),task=randomUUID(),pins={expected_worker_boot_id:boot,expected_worker_config_digest:catalog.body.receipt.config_digest};
  const started=await call(`/workflows/${run}/start`,{run_id:run,task_id:task,request_nonce:randomUUID(),profile:'fixed',profile_sha256:digest,mode:'exploration',input:{run_tag:'test'},...pins});assert.equal(started.status,200);
  const deadline=Date.now()+5000;while(!fs.existsSync(path.join(root,'domain-loaded'))&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
  assert.equal(fs.readFileSync(path.join(root,'domain-loaded'),'utf8'),'true');assert.equal(JSON.stringify(config),initial);
  const inspected=await call(`/workflows/${run}/inspect`,{run_id:run,task_id:task,request_nonce:randomUUID(),...pins});assert.equal(inspected.status,200,JSON.stringify(inspected.body));assert.equal(inspected.body.receipt.worker_config_digest,pins.expected_worker_config_digest);
 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}runner?.close();fs.rmSync(root,{recursive:true,force:true});}
}));
