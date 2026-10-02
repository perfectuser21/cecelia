import {it,expect} from 'vitest';
import {randomUUID,createHmac} from 'node:crypto';
import {verifyLinuxInstallation} from './onboarding-installation.js';
function fixture(){
 const key='a'.repeat(64),expected={nonce:'b'.repeat(64),intent_id:randomUUID(),machine_registry_id:randomUUID(),revision:'c'.repeat(40),pool:{canary_image:'alpine@sha256:'+'d'.repeat(64),pool:{cpu_cores:1,memory_bytes:2*2**30}},key};
 const receipt={schema_version:'linux-onboarding-install/v1',nonce:expected.nonce,machine_registry_id:expected.machine_registry_id,host_boot_id:randomUUID(),daemon_id:'daemon',
  image_id:'sha256:'+'d'.repeat(64),image:expected.pool.canary_image,observed_at:new Date().toISOString(),intent_id:expected.intent_id,revision:expected.revision,worker_boot_id:randomUUID(),pool:expected.pool,installed:true,execution:false,os:'linux',resources:{cpu_cores:4,memory_total_bytes:8*2**30}};
 const sign=()=>({receipt,signature:createHmac('sha256',key).update(JSON.stringify(receipt)).digest('hex')});return {expected,receipt,sign};
}
it('只有root独立key签名且nonce/intent/机器/策略同代才接受安装事实',()=>{
 const f=fixture();expect(verifyLinuxInstallation(f.sign(),f.expected)).toEqual(f.receipt);
});
it.each(['nonce','intent_id','machine_registry_id','revision','pool','boot','key','stale','execution'])('%s漂移拒绝写部署',kind=>{
 const f=fixture();if(['nonce','intent_id','machine_registry_id','revision'].includes(kind))f.receipt[kind]='other';
 if(kind==='pool')f.receipt.pool={...f.receipt.pool,extra:true};if(kind==='boot')f.receipt.worker_boot_id='unknown';if(kind==='key')f.expected.key='f'.repeat(64);
 if(kind==='stale')f.receipt.observed_at=new Date(Date.now()-120001).toISOString();if(kind==='execution')f.receipt.execution=true;
 expect(()=>verifyLinuxInstallation(f.sign(),f.expected)).toThrow('linux_pool_installation_unconfirmed');
});
