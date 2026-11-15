import {it as test} from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {publishFoundation} from '../foundation-publish.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'foundation-publish-')),revision='a'.repeat(40),repo='example/workflows';
 const directory=path.join(root,repo,revision);fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'profile.json'),'profile bytes');
 const components=[{kind:'repo',repo,revision},{kind:'code',repo,revision,path:'profile.json',digest:'sha256:'+sha('profile bytes')}];
 const plan={release:{release_key:'example-1',environment:'scratch',target:'worker-a/report',actor:'test',workflows:[{workflow_definition_version_id:'def-1',payload_sha256:'b'.repeat(64)}],components,ci_evidence:[]},observation:{event_key:'deployment-1',attempt_key:'attempt-1',environment:'scratch',target:'worker-a/report',components,collector:'test-collector',observed_at:'2026-11-15T00:00:00Z',evidence_ref:'test:actual-files'}};
 return {root,directory,plan,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
function transport({gate=true,ready=true,verified=true}={}){
 const calls=[];
 return {calls,fetch:async(url,init={})=>{
  calls.push({path:new URL(url).pathname,method:init.method,body:init.body&&JSON.parse(init.body)});
  let data;
  if(url.endsWith('/releases'))data={release:{id:'release-1',payload:{verification:{status:verified?'verified':'unknown'},workflows:[{id:'def-1',workflow_id:'workflow-1'}]}}};
  else if(url.endsWith('/observations'))data={observation:{id:'observation-1'}};
  else if(url.endsWith('/gate'))data={deployed:gate,current_observation_id:'observation-1'};
  else if(url.endsWith('/catalog'))data={workflows:[{workflow_id:'workflow-1',release_id:'release-1',workflow_definition_version_id:'def-1',status:ready?'ready':'blocked'}]};
  else throw Error('unexpected request');
  return {ok:true,status:200,json:async()=>data};
 }};
}
test('CI发布先验本机冻结文件，再登记release/部署观测，读回可派目录；不创建业务Task',async()=>{
 const f=fixture(),t=transport();try{const r=await publishFoundation(f.plan,{bundleRoot:f.root,machineId:'worker-a',base:'http://127.0.0.1:5222/api/brain',fetch:t.fetch});assert.equal(r.status,'ready');assert.equal(r.release_id,'release-1');assert.deepEqual(t.calls.map(x=>x.path),['/api/brain/releases','/api/brain/releases/release-1/observations','/api/brain/releases/release-1/gate','/api/brain/workflow-foundation/catalog']);assert.equal(t.calls.some(x=>x.path.includes('/tasks')),false);}finally{f.close();}
});
test('本机产物漂移在任何发布写入前拒绝',async()=>{
 const f=fixture(),t=transport();try{fs.writeFileSync(path.join(f.directory,'profile.json'),'changed');await assert.rejects(publishFoundation(f.plan,{bundleRoot:f.root,machineId:'worker-a',base:'http://127.0.0.1:5222/api/brain',fetch:t.fetch}),/component_drift/);assert.equal(t.calls.length,0);}finally{f.close();}
});
test('CI未核验不记录部署；部署未通过或目录blocked均不能报ready',async()=>{
 const f=fixture();try{for(const mode of [{verified:false},{gate:false},{ready:false}]){const t=transport(mode);await assert.rejects(publishFoundation(f.plan,{bundleRoot:f.root,machineId:'worker-a',base:'http://127.0.0.1:5222/api/brain',fetch:t.fetch}),/unverified|unavailable/);if(mode.verified===false)assert.equal(t.calls.length,1);}}finally{f.close();}
});
test('组件路径逃逸、符号链接、观测组件不一致与不安全地址均拒绝',async()=>{
 const f=fixture();try{
  const p=structuredClone(f.plan);p.release.components[1].path='../outside';await assert.rejects(publishFoundation(p,{bundleRoot:f.root,machineId:'worker-a',base:'http://127.0.0.1:5222/api/brain'}),/component_path/);
  const mismatch=structuredClone(f.plan);mismatch.observation.components=[];await assert.rejects(publishFoundation(mismatch,{bundleRoot:f.root,machineId:'worker-a',base:'http://127.0.0.1:5222/api/brain'}),/components_mismatch/);
  await assert.rejects(publishFoundation(f.plan,{bundleRoot:f.root,machineId:'worker-b',base:'http://127.0.0.1:5222/api/brain'}),/machine_mismatch/);
  fs.unlinkSync(path.join(f.directory,'profile.json'));fs.symlinkSync('/etc/hosts',path.join(f.directory,'profile.json'));await assert.rejects(publishFoundation(f.plan,{bundleRoot:f.root,machineId:'worker-a',base:'http://127.0.0.1:5222/api/brain'}),/component_path/);
  await assert.rejects(publishFoundation(f.plan,{bundleRoot:f.root,machineId:'worker-a',base:'http://example.com/api/brain',token:'secret'}),/endpoint/);
 }finally{f.close();}
});

test('实测时间来自目标机，同次网络重试复用事件，新部署产生新观测',async()=>{
 const f=fixture(),statePath=path.join(f.root,'deployment.json'),t=transport(),sent=[];let lose=true;
 const fetch=async(url,init)=>{const response=await t.fetch(url,init);if(url.endsWith('/observations')){sent.push(JSON.parse(init.body));if(lose){lose=false;throw Error('response_lost');}}return response;};
 try{
  f.plan.observation.observed_at='2099-01-01T00:00:00Z';
  const opts={bundleRoot:f.root,machineId:'worker-a',base:'http://127.0.0.1:5222/api/brain',fetch,statePath};
  const before=Date.now();await assert.rejects(publishFoundation(f.plan,opts),/response_lost/);
  await publishFoundation(f.plan,opts);assert.deepEqual(sent[0],sent[1]);assert(Date.parse(sent[0].observed_at)>=before);assert(Date.parse(sent[0].observed_at)<=Date.now());
  await publishFoundation(f.plan,{...opts,statePath:path.join(f.root,'next-deployment.json')});assert.notEqual(sent[2].event_key,sent[1].event_key);assert(Date.parse(sent[2].observed_at)>=Date.parse(sent[1].observed_at));
 }finally{f.close();}
});
