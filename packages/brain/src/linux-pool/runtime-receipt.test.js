import {createHmac,randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {verifyRuntimeEnvelope} from './runtime-receipt.js';
import {fixture} from './__tests__/runtime-receipt-fixture.js';
it('root独立签名绑定完整版本/grant/profile、宿主proof、输出和取消墓碑',()=>{const f=fixture();expect(verifyRuntimeEnvelope(f.envelope(),f.challenge,f.deployment,f.now).receipt).toEqual(f.receipt);});
it('自报成功缺少任一身份/宿主/输出/精确清理或nonce时不得激活',()=>{
 for(const mutate of [r=>r.nonce='f'.repeat(64),r=>r.execution=true,r=>r.worker_boot_id=randomUUID(),r=>r.cases=[],r=>r.cases.push(r.cases[0]),
  r=>r.cases[0].identity.execution_grant_id=randomUUID(),r=>r.cases[0].profile_digest='f'.repeat(64),r=>r.cases[0].proof.cpu_cores=99,
  r=>r.cases[0].proof.identity={...r.cases[0].identity,intent_id:randomUUID()},r=>r.cases[0].terminal.stdout='ok',r=>r.cases[0].terminal.timed_out=true,
  r=>r.cases[0].cleanup.container_id='f'.repeat(64),r=>r.cases[0].cleanup.tombstoned=false,r=>r.completed_at='2000-01-01T00:00:00Z']){
  const f=fixture();mutate(f.receipt);expect(()=>verifyRuntimeEnvelope(f.envelope(),f.challenge,f.deployment,f.now)).toThrow('linux_pool_runtime_receipt_invalid');
 }
 const f=fixture(),e=f.envelope();e.signature=createHmac('sha256',f.deployment.workerToken).update(JSON.stringify(e.receipt)).digest('hex');
 expect(()=>verifyRuntimeEnvelope(e,f.challenge,f.deployment,f.now)).toThrow('linux_pool_runtime_receipt_invalid');
});
