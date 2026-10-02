import {it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHmac,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const canary=require('../../../packages/brain/scripts/fleet-worker/linux-script-canary.cjs');
const proof=require('../../../packages/brain/scripts/fleet-worker/linux-pool-proof.cjs');
const fixtureModule=require('../../../packages/brain/scripts/fleet-worker/linux-script-test-fixture.cjs');
it('F1造完真验：真实proof拒绝沿canary边落固定stage，清理不能签成功',async()=>{
 const f=fixtureModule.fixture(),root=fs.mkdtempSync(path.join(os.tmpdir(),'gp-linux-proof-')),nonce='c'.repeat(64),key='b'.repeat(64);
 const d={pool:f.record.pool,revision:'d'.repeat(40),host_boot_id:randomUUID(),worker_boot_id:f.record.identity.worker_boot_id,
  daemon_id:f.record.daemon_id,execution_enabled:true,profiles:{safe:{profile:f.record.profile,image_id:f.record.image_id,execution_version_id:f.record.identity.execution_version_id,execution_grant_id:f.record.identity.execution_grant_id}}};
 let container,stageBeforeCleanup;const client={};
 for(const action of ['start','cancel'])client[action]=async body=>{
  if(action==='start')container='a'.repeat(64);
  else stageBeforeCleanup=JSON.parse(fs.readFileSync(path.join(root,nonce+'.json'))).failure.stage;
  const {permit,...identity}=body;
  const receipt={...identity,container_id:container,status:action==='start'?'running':'cleaned',...(action==='cancel'?{absent:true,tombstoned:true}:{})};
  return {status:200,envelope:{receipt,signature:createHmac('sha256',key).update(JSON.stringify(receipt)).digest('hex')}};
 };
 try{
  await expect(canary.runLinuxScriptCanary({nonce},{platform:'linux',getuid:()=>0,lockHeld:true,stateRoot:root,rootUid:process.getuid(),
   loadConfiguration:()=>({deployment:d,key,workerToken:'e'.repeat(64)}),identity:async()=>({worker_boot_id:d.worker_boot_id}),client,
   collectProof:input=>proof.collectLinuxScriptProof({...input,deps:{getuid:()=>0,readlink:async()=>{throw Object.assign(Error('private-transport-text'),{stage:'attacker'});}}})
  })).rejects.toThrow('linux_script_canary_unconfirmed');
  const raw=fs.readFileSync(path.join(root,nonce+'.json'),'utf8'),state=JSON.parse(raw);
  expect(stageBeforeCleanup).toBe('host_identity');expect(state.failure.stage).toBe('host_identity');
  expect(state.cleanup_confirmed).toBe(true);expect(state.envelope).toBeUndefined();
  expect(raw).not.toContain('private-transport-text');expect(raw).not.toContain('attacker');expect(raw).not.toContain(key);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
