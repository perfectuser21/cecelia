import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createNativeAgentHostFixture} from '../../../src/__tests__/helpers/native-agent-host-fixture.js';
import {groupMembers} from '../process.mjs';

test('候选只读镜像与noexec临时盘仍能真实执行原生夹具并确认退出', {timeout:20000}, async t=>{
 const host=createNativeAgentHostFixture();t.after(()=>host.close());
 if(process.env.CANDIDATE_NOEXEC_CONTRACT==='1'){
  assert.equal(process.platform,'linux');
  const mount=readFileSync('/proc/mounts','utf8').split('\n').find(line=>line.split(' ')[1]==='/tmp');
  assert.ok(mount?.split(' ')[3].split(',').includes('noexec'),'验收必须保留/tmp noexec');
  const probe=join(host.root,'execution-must-be-denied');writeFileSync(probe,'#!/bin/sh\nexit 0\n',{mode:0o700});
  assert.equal(spawnSync(probe,[]).error?.code,'EACCES','负向对照必须被内核拒绝');
 }
 const prompt='候选镜像真实进程验收',request={protocol:'native-agent/v1',action:'start',tenant:'fixture-native',department:'main',role:'agent',account_ref:'fixture-account',task_id:randomUUID(),run_id:randomUUID(),request_nonce:randomUUID(),input_digest:createHash('sha256').update(prompt).digest('hex'),prompt,model:'fixture-model',thinking:'medium',skill_ids:[],timeout_ms:10000,deadline_ms:Date.now()+10000};
 const control=Object.fromEntries(Object.entries({...request,action:'inspect'}).filter(([key])=>!['prompt','model','thinking','skill_ids','timeout_ms','deadline_ms'].includes(key)));
 await host.transport(host.host,request);
 let receipt;
 for(let i=0;i<100;i++){
  receipt=await host.transport(host.host,control);
  assert.equal(receipt.error,undefined,JSON.stringify({status:receipt.status,error:receipt.error}));
  if(receipt.execution_stopped)break;
  await new Promise(resolve=>setTimeout(resolve,30));
 }
 assert.equal(receipt.status,'completed',JSON.stringify(receipt));
 assert.equal(receipt.execution_stopped,true);assert.equal(receipt.result.child_exited,true);
 assert.deepEqual(groupMembers(receipt.child.pid),[]);
 assert.equal(receipt.result.exit_code,0);assert.equal(receipt.result.final_text,'实际fixture执行结果：完整输入已处理');
 assert.equal(host.launches().length,1);assert.ok(host.launches()[0].text.includes(prompt));
 assert.equal(readFileSync(join(host.root,'state',request.run_id,'final.txt'),'utf8'),receipt.result.final_text);
 await host.transport(host.host,request);assert.equal(host.launches().length,1,'重放不得重复执行');
});

test('候选隔离夹具挂起后仅取消原run并真实确认进程组退出', {timeout:20000}, async t=>{
 const host=createNativeAgentHostFixture();t.after(()=>host.close());
 const prompt='NATIVE_HANG 候选取消验收',request={protocol:'native-agent/v1',action:'start',tenant:'fixture-native',department:'main',role:'agent',account_ref:'fixture-account',task_id:randomUUID(),run_id:randomUUID(),request_nonce:randomUUID(),input_digest:createHash('sha256').update(prompt).digest('hex'),prompt,model:'fixture-model',thinking:'medium',skill_ids:[],timeout_ms:10000,deadline_ms:Date.now()+10000};
 const control=Object.fromEntries(Object.entries({...request,action:'inspect'}).filter(([key])=>!['prompt','model','thinking','skill_ids','timeout_ms','deadline_ms'].includes(key)));
 await host.transport(host.host,request);
 let receipt;
 for(let i=0;i<100;i++){
  receipt=await host.transport(host.host,control);
  assert.equal(receipt.error,undefined);
  if(receipt.launch_state==='running')break;
  await new Promise(resolve=>setTimeout(resolve,30));
 }
 assert.equal(receipt.launch_state,'running');
 receipt=await host.transport(host.host,{...control,action:'cancel'});
 assert.equal(receipt.run_id,request.run_id);assert.equal(receipt.status,'cancelled');
 assert.equal(receipt.execution_stopped,true);assert.equal(receipt.result.child_exited,true);
 assert.deepEqual(groupMembers(receipt.child.pid),[]);
 assert.equal(host.launches().length,1);
});
