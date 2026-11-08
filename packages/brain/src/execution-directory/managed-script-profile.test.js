import {afterEach,it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHmac} from 'node:crypto';
import {createRequire} from 'node:module';
import express from 'express';
import request from 'supertest';
import {readManagedScriptCandidates,verifyProfileCatalog,createProfileCatalogClient} from './managed-script-profile-evidence.js';
import {createExecutionScriptProfilesRouter} from '../routes/execution-script-profiles.js';
const roots=[];afterEach(()=>roots.splice(0).forEach(r=>fs.rmSync(r,{recursive:true,force:true})));
const token='private-worker-transport-key-'.repeat(3),hash='a'.repeat(64),boot=randomUUID();
const candidate=()=>({machine_id:'us-mac-m4',machine_registry_id:'ed3555dc-4777-446c-bdf0-d928d6a08ef1',profile_sha256:hash,source_repo:'perfectuser21/zenithjoy',source_commit:'b'.repeat(40),release_id:randomUUID(),observation_id:randomUUID(),evidence_task_id:randomUUID(),expires_at:new Date(Date.now()+3600000).toISOString()});
const sign=receipt=>({receipt,signature:createHmac('sha256',token).update(JSON.stringify(receipt)).digest('hex')});
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
 const server=createFleetWorkerServer({machineId:'us-mac-m4',attemptToken:token,launchAdmission:{snapshot:()=>({boot_id:boot,activity_revision:0})},runtimeConfigDigest:hash,workflowRunner:{capabilities:()=>({profiles:{'leadgen-candidate':hash}})}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const origin=`http://127.0.0.1:${server.address().port}`,body={profile_id:'leadgen-candidate',request_nonce:randomUUID()};
  const bad=await fetch(origin+'/workflows/profile-catalog',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});expect(bad.status).toBe(401);
  const client=createProfileCatalogClient({token,fetchFn:(url,options)=>fetch(origin+new URL(url).pathname,options)});
  const receipt=await client.catalog({canonical_id:'us-mac-m4',endpoints:{worker:'http://100.71.151.105:5231'}},{profileId:'leadgen-candidate',profileSha256:hash,bootId:boot,configDigest:hash});
  expect(receipt.profile_sha256).toBe(hash);expect(receipt.machine_id).toBe('us-mac-m4');
  const unknown=await fetch(origin+'/workflows/profile-catalog',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({...body,profile_id:'missing'})});expect(unknown.status).toBe(409);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
it('受保护API只转发profile路径与CAS请求，认证错误不触及store',async()=>{
 let calls=0;const app=express();app.use(express.json());app.use('/execution',createExecutionScriptProfilesRouter({env:{CECELIA_INTERNAL_TOKEN:token},store:{activate:async(profile,body)=>{calls++;return {profile,body};}}}));
 expect((await request(app).post('/execution/script-profiles/leadgen-candidate/activate').send({})).status).toBe(401);expect(calls).toBe(0);
 const r=await request(app).post('/execution/script-profiles/leadgen-candidate/activate').set('x-cecelia-token',token).send({expected_config_hash:hash});expect(r.status).toBe(200);expect(r.body.profile).toBe('leadgen-candidate');expect(calls).toBe(1);
});
