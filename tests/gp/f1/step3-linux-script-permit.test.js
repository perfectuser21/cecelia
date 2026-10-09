import {randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import permitApi from '../../../packages/brain/scripts/fleet-worker/linux-script-permit.cjs';
it('F1造完真验：Linux脚本许可绑定机器、boot、同代授权与实际请求，不能跨代重放',()=>{
 const key='a'.repeat(64),now=Date.now();
 const expected={machine_registry_id:randomUUID(),pool_config_digest:'b'.repeat(64),revision:'c'.repeat(40),
  host_boot_id:randomUUID(),worker_boot_id:randomUUID(),daemon_id:'fixture-daemon',
  execution_version_id:randomUUID(),execution_grant_id:randomUUID(),profile_digest:'d'.repeat(64)};
 const body={reservation_id:randomUUID(),request_nonce:randomUUID(),job:{cmd:'printf verified'}};
 const input={key,expected,action:'start',body,now};
 const permit=permitApi.signLinuxScriptPermit(input);
 expect(permitApi.verifyLinuxScriptPermit({...input,permit})).toMatchObject({action:'start',execution_grant_id:expected.execution_grant_id});
 for(const changed of [{expected:{...expected,worker_boot_id:randomUUID()}},{expected:{...expected,execution_grant_id:randomUUID()}},
  {body:{...body,job:{cmd:'different'}}},{now:now+30000},{action:'cancel'}]){
  expect(()=>permitApi.verifyLinuxScriptPermit({...input,permit,...changed})).toThrow('linux_script_permit_unverified');
 }
});
