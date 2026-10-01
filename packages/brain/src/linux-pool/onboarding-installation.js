import {createHmac,timingSafeEqual} from 'node:crypto';
import {UUID,HEX,error,exact} from './deployment.js';
export function verifyLinuxInstallation(envelope,expected,now=Date.now()){
 const fail=()=>{throw error('linux_pool_installation_unconfirmed');};
 try{
  if(!exact(envelope,['receipt','signature'])||!HEX.test(envelope.signature??'')||!HEX.test(expected.key??''))fail();
  const raw=JSON.stringify(envelope.receipt);if(Buffer.byteLength(raw)>65536)fail();
  const signature=createHmac('sha256',expected.key).update(raw).digest();
  if(!timingSafeEqual(signature,Buffer.from(envelope.signature,'hex')))fail();
  const r=envelope.receipt;
  if(!exact(r,['schema_version','nonce','machine_registry_id','host_boot_id','daemon_id','image_id','image','observed_at','intent_id','revision','worker_boot_id','pool','installed','execution','os','resources'])
   ||r.schema_version!=='linux-onboarding-install/v1'||r.installed!==true||r.execution!==false
   ||['nonce','intent_id','machine_registry_id','revision'].some(k=>r[k]!==expected[k])
   ||JSON.stringify(r.pool)!==JSON.stringify(expected.pool)||r.image!==expected.pool.canary_image
   ||!UUID.test(r.host_boot_id??'')||!UUID.test(r.worker_boot_id??'')||!/^sha256:[a-f0-9]{64}$/.test(r.image_id??'')
   ||typeof r.daemon_id!=='string'||!r.daemon_id||r.daemon_id.length>256)fail();
  const cpu=r.resources?.cpu_cores,memory=r.resources?.memory_total_bytes;
  if(r.os!=='linux'||!Number.isInteger(cpu)||cpu<1||!Number.isSafeInteger(memory)||memory<=0
   ||!r.pool.pool||r.pool.pool.cpu_cores>Math.min(2,cpu/2)||r.pool.pool.memory_bytes>Math.min(4*2**30,memory-Math.max(2*2**30,Math.ceil(memory/2))))fail();
  const age=now-Date.parse(r.observed_at);if(!Number.isFinite(age)||age< -30000||age>120000)fail();return structuredClone(r);
 }catch{fail();}
}
