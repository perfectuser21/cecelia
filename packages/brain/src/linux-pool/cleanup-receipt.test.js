import {createHmac,randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {fixture} from './runtime-receipt.test-fixture.js';
import {verifyCleanupEnvelope} from './cleanup-receipt.js';
import {verifyRuntimeEnvelope} from './runtime-receipt.js';
const sign=(receipt,key)=>({receipt,signature:createHmac('sha256',key).update(JSON.stringify(receipt)).digest('hex')});
function sample(){const f=fixture(),r=structuredClone(f.receipt);r.schema_version='linux-script-canary-cleanup/v1';delete r.script_adapter_verified;
 r.cases=r.cases.map(({proof,terminal,...c})=>({...c,not_started:false}));return {...f,r};}
it('独立cleanup签名只确认完整身份墓碑，不能被激活验收入口接受',()=>{
 const f=sample(),e=sign(f.r,f.deployment.key);expect(verifyCleanupEnvelope('script',e,f.challenge,f.deployment,f.now).receipt).toEqual(f.r);
 expect(()=>verifyRuntimeEnvelope(e,f.challenge,f.deployment,f.now)).toThrow();
});
it('错root签名、身份、profile、墓碑或未知对象都不能淘汰旧挑战',()=>{
 for(const change of [r=>r.execution=true,r=>r.nonce='f'.repeat(64),r=>r.worker_boot_id=randomUUID(),r=>r.cases=[],r=>r.cases[0].cleanup.absent=false,
  r=>r.cases[0].cleanup.tombstoned=false,r=>r.cases[0].identity.execution_grant_id=randomUUID(),r=>r.cases[0].profile_digest='f'.repeat(64),r=>r.cases[0].not_started=true]){
  const f=sample();change(f.r);expect(()=>verifyCleanupEnvelope('script',sign(f.r,f.deployment.key),f.challenge,f.deployment,f.now)).toThrow('linux_pool_cleanup_receipt_invalid');
 }
 const f=sample();expect(()=>verifyCleanupEnvelope('script',sign(f.r,f.deployment.workerToken),f.challenge,f.deployment,f.now)).toThrow();
});
it('尚未尝试启动必须同时没有容器和清理副作用；认证取消的null容器墓碑可确认未抵达',()=>{
 const f=sample(),c=f.r.cases[0];c.not_started=true;c.container_id=null;c.cleanup=null;
 expect(verifyCleanupEnvelope('script',sign(f.r,f.deployment.key),f.challenge,f.deployment,f.now)).toBeTruthy();
 const next=sample();next.r.cases[0].container_id=null;next.r.cases[0].cleanup.container_id=null;
 expect(verifyCleanupEnvelope('script',sign(next.r,next.deployment.key),next.challenge,next.deployment,next.now)).toBeTruthy();
});
