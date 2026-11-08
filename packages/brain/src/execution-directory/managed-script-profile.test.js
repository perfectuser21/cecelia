import {afterEach,it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHmac,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import express from 'express';
import request from 'supertest';
import {readManagedScriptCandidates,verifyProfileCatalog,createProfileCatalogClient,assertManagedScriptProfileGrant} from './managed-script-profile-evidence.js';
import {hashConfig} from './directory.js';
import {createExecutionScriptProfilesRouter} from '../routes/execution-script-profiles.js';
const roots=[];afterEach(()=>roots.splice(0).forEach(r=>fs.rmSync(r,{recursive:true,force:true})));
const token='private-worker-transport-key-'.repeat(3),hash='a'.repeat(64),boot=randomUUID();
const candidate=()=>({machine_id:'us-mac-m4',machine_registry_id:'ed3555dc-4777-446c-bdf0-d928d6a08ef1',profile_sha256:hash,source_repo:'perfectuser21/zenithjoy',source_commit:'b'.repeat(40),release_id:randomUUID(),observation_id:randomUUID(),evidence_task_id:randomUUID(),expires_at:new Date(Date.now()+3600000).toISOString()});
const sign=receipt=>({receipt,signature:createHmac('sha256',token).update(JSON.stringify(receipt)).digest('hex')});
it('新Mac grant在每次start前必须与原政策和路由digest闭合，旧grant保持既有行为',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'script-grant-'));roots.push(root);const file=path.join(root,'candidates.json'),c=candidate(),version=randomUUID();
 fs.writeFileSync(file,JSON.stringify({schema_version:1,profiles:{'leadgen-candidate':c}}),{mode:0o600});
 const grant={provenance:'mac_managed_profile/v1:'+hashConfig(c),state:'active',profile_id:'leadgen-candidate',account_id:'',repo_scope:[],evidence_task_id:c.evidence_task_id,expires_at:c.expires_at,node_version_id:version};
 const components=[{kind:'repo',repo:c.source_repo,revision:c.source_commit}];
 const db={query:async(sql)=>({rows:sql.includes('FROM tasks')?[{id:c.evidence_task_id,status:'in_progress',result:{ship_candidate:{schema_version:1,stage:'candidate',task_id:c.evidence_task_id,repo:c.source_repo,head_sha:c.source_commit,actor:'candidate',facts:['source'],evidence:['owned:source']}}}]
  :sql.includes('FROM release_versions')?[{id:c.release_id,environment:'test',target:c.machine_id,payload:{components,verification:{status:'verified',ci_status:'verified'}}}]
   :sql.includes('FROM release_observations')?[{id:c.observation_id,release_id:c.release_id,payload:{environment:'test',target:c.machine_id,components},collector:'owned',evidence_ref:'owned:observation'}]:[]})};
 const identity={db,grant,profileId:'leadgen-candidate',profileSha256:hash,machineId:'us-mac-m4',executionVersionId:version},env={EXECUTION_MANAGED_SCRIPT_CANDIDATES_FILE:file};
 expect(await assertManagedScriptProfileGrant(identity,env)).toEqual(c);
 expect(await assertManagedScriptProfileGrant({...identity,grant:{...grant,expires_at:new Date(c.expires_at)}},env)).toEqual(c);
 for(const change of [{profileSha256:'c'.repeat(64)},{machineId:'mmv'},{executionVersionId:randomUUID()},{grant:{...grant,state:'revoked'}}])await expect(assertManagedScriptProfileGrant({...identity,...change},env)).rejects.toThrow('execution_script_grant_policy');
 await expect(assertManagedScriptProfileGrant(identity,{})).rejects.toThrow();
 fs.writeFileSync(file,JSON.stringify({schema_version:1,profiles:{'leadgen-candidate':{...c,source_commit:'c'.repeat(40)}}}));
 await expect(assertManagedScriptProfileGrant(identity,env)).rejects.toThrow('execution_script_grant_policy');
 expect(await assertManagedScriptProfileGrant({grant:{provenance:'legacy_policy'}},{})).toBeNull();
});
it('真实PG回归必须进入PR的实际Brain integration命令',async()=>{
 const {commandsFor}=await import('../../../../scripts/ci/run-basic-check.mjs');
 expect(commandsFor('brain-integration').some(step=>step.ciScratchDatabase===true&&step.args.includes('src/__tests__/integration/managed-script-profile.pg.integration.test.js'))).toBe(true);
});
it('候选仅来自0600固定政策，拒绝额外命令、无效Mac、过期和宽权限',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'script-policy-'));roots.push(root);const file=path.join(root,'candidates.json'),c=candidate();
 const put=(value,mode=0o600)=>{fs.writeFileSync(file,JSON.stringify(value),{mode});fs.chmodSync(file,mode);};
 put({schema_version:1,profiles:{'leadgen-candidate':c}});expect(readManagedScriptCandidates(file)['leadgen-candidate']).toEqual(c);
 for(const bad of [{...c,cmd:'shell'},{...c,machine_id:'mmv'},{...c,expires_at:'2000-01-01T00:00:00.000Z'}]){put({schema_version:1,profiles:{'leadgen-candidate':bad}});expect(()=>readManagedScriptCandidates(file)).toThrow('execution_script_policy');}
 put({schema_version:1,profiles:{'leadgen-candidate':c}},0o644);expect(()=>readManagedScriptCandidates(file)).toThrow('execution_script_policy');
});
it('catalog回执必须nonce/HMAC/机器/profile/boot/config和新鲜时间全部一致',()=>{
 const nonce=randomUUID(),receipt={schema_version:'fleet-workflow-profile/v1',machine_id:'us-mac-m4',request_nonce:nonce,profile_id:'leadgen-candidate',profile_sha256:hash,boot_id:boot,config_digest:hash,observed_at:new Date().toISOString()};
 const expected={token,nonce,machineId:'us-mac-m4',profileId:'leadgen-candidate',profileSha256:hash,bootId:boot,configDigest:hash};
 expect(verifyProfileCatalog(sign(receipt),expected)).toEqual(receipt);
 for(const change of [{request_nonce:randomUUID()},{profile_sha256:'c'.repeat(64)},{machine_id:'mmv'},{boot_id:randomUUID()},{config_digest:'c'.repeat(64)},{observed_at:'2000-01-01T00:00:00Z'}])expect(()=>verifyProfileCatalog(sign({...receipt,...change}),expected)).toThrow('execution_script_worker_unconfirmed');
 expect(()=>verifyProfileCatalog({...sign(receipt),signature:'0'.repeat(64)},expected)).toThrow('execution_script_worker_unconfirmed');
});
it('真实Worker HTTP catalog需要原transport认证，绑定真实profile原摘要而非请求提供摘要',async()=>{
 const require=createRequire(import.meta.url),{createFleetWorkerServer}=require('../../scripts/fleet-worker/fleet-worker.cjs');
 const server=createFleetWorkerServer({machineId:'us-mac-m4',attemptToken:token,launchAdmission:{snapshot:()=>({boot_id:boot,activity_revision:0})},runtimeConfigDigest:hash,workflowProfileCatalog:id=>{if(id!=='leadgen-candidate')throw Error('unknown');return hash;}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const origin=`http://127.0.0.1:${server.address().port}`,body={profile_id:'leadgen-candidate',request_nonce:randomUUID()};
  const bad=await fetch(origin+'/workflows/profile-catalog',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});expect(bad.status).toBe(401);
  const client=createProfileCatalogClient({token,fetchFn:(url,options)=>fetch(origin+new URL(url).pathname,options)});
  const receipt=await client.catalog({canonical_id:'us-mac-m4',endpoints:{worker:'http://100.71.151.105:5231'}},{profileId:'leadgen-candidate',profileSha256:hash,bootId:boot,configDigest:hash});
  expect(receipt.profile_sha256).toBe(hash);expect(receipt.machine_id).toBe('us-mac-m4');
  expect(receipt.signature).toMatch(/^[a-f0-9]{64}$/);
  expect(createHmac('sha256',token).update(JSON.stringify(receipt.receipt)).digest('hex')).toBe(receipt.signature);
  const unknown=await fetch(origin+'/workflows/profile-catalog',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({...body,profile_id:'missing'})});expect(unknown.status).toBe(409);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
it('生产Worker组装的catalog检查真实源文件，不能仅签内存profile摘要',()=>{
 const require=createRequire(import.meta.url),{createFleetWorkerRuntime}=require('../../scripts/fleet-worker/fleet-worker.cjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'script-catalog-source-'));roots.push(root);
 const source=path.join(root,'activity.mjs'),tokenFile=path.join(root,'token'),profiles=path.join(root,'profiles.json');
 fs.writeFileSync(source,'export const fixed = true;');fs.writeFileSync(tokenFile,token,{mode:0o600});
 const profile={cwd:root,files:{'activity.mjs':createHash('sha256').update(fs.readFileSync(source)).digest('hex')},metadata:{probe:{executor_kind:'code',activity_id:randomUUID()}},contract:{activities:[{key:'probe',runtime:{entry:'activity.mjs'}}]}};
 fs.writeFileSync(profiles,JSON.stringify({schema_version:1,profiles:{'leadgen-candidate':profile}}),{mode:0o600});
 const runtime=createFleetWorkerRuntime({env:{CECELIA_MACHINE_ID:'us-mac-m4',CECELIA_RUNNER_DIGEST:'sha256:'+hash,CECELIA_FLEET_DATA_ROOT:path.join(root,'worker'),CECELIA_FLEET_WORKER_TOKEN_FILE:tokenFile,CECELIA_WORKFLOW_PROFILES_FILE:profiles},probeCredentialHome:()=>{}});
 expect(runtime.workflowProfileCatalog('leadgen-candidate')).toMatch(/^[a-f0-9]{64}$/);
 fs.appendFileSync(source,'\nexport const changed = true;');expect(()=>runtime.workflowProfileCatalog('leadgen-candidate')).toThrow('workflow_source_mismatch');
});
it('受保护API只转发profile路径与CAS请求，认证错误不触及store',async()=>{
 let calls=0;const app=express();app.use(express.json());app.use('/execution',createExecutionScriptProfilesRouter({env:{CECELIA_INTERNAL_TOKEN:token},store:{activate:async(profile,body)=>{calls++;return {profile,body};}}}));
 expect((await request(app).post('/execution/script-profiles/leadgen-candidate/activate').send({})).status).toBe(401);expect(calls).toBe(0);
 const r=await request(app).post('/execution/script-profiles/leadgen-candidate/activate').set('x-cecelia-token',token).send({expected_config_hash:hash});expect(r.status).toBe(200);expect(r.body.profile).toBe('leadgen-candidate');expect(calls).toBe(1);
});
it('Worker收到启动或旧run检查时必须在调用Runner前CAS本轮boot/config，封住catalog到start换代竞态',async()=>{
 const require=createRequire(import.meta.url),{createFleetWorkerServer}=require('../../scripts/fleet-worker/fleet-worker.cjs');let called=0;
 const server=createFleetWorkerServer({machineId:'us-mac-m4',attemptToken:token,launchAdmission:{snapshot:()=>({boot_id:boot})},runtimeConfigDigest:hash,workflowRunner:{start:async()=>{called++;return {};},inspect:async()=>{called++;return {};}}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{for(const action of ['start','inspect']){const body={run_id:randomUUID(),task_id:randomUUID(),request_nonce:randomUUID(),expected_worker_boot_id:randomUUID(),expected_worker_config_digest:hash};
  const r=await fetch(`http://127.0.0.1:${server.address().port}/workflows/${body.run_id}/${action}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});expect(r.status).toBe(409);
 }expect(called).toBe(0);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
