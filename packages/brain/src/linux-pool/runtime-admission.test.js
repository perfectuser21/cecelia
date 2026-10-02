import {randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {fixture} from './__tests__/runtime-receipt-fixture.js';
import {createLinuxRuntimeAdmission} from './runtime-admission.js';
import workerModule from '../../scripts/fleet-worker/linux-pool-server.cjs';
import canaryModule from '../../scripts/fleet-worker/linux-pool-canary.cjs';
function setup(){
 const f=fixture(),node={id:f.challenge.execution_version_id,platform:'linux',profile:{capacity:1,execution:true,linux_script:f.deployment.authority}},grant={id:f.challenge.grant_ids.safe,profile_id:'safe'};
 let row={policy_digest:f.deployment.policyDigest},boot=f.deployment.expected.worker_boot_id;
 const client={query:async()=>({rows:row?[row]:[]})};
 const deps={pool:{},readDeployment:async()=>f.deployment,authorizeRequest:async(_pool,input,fn)=>{expect(input.surface).toBe('managed_script');return fn({node,grant},client);},
  readIdentity:async input=>{expect(input.token).toBe(f.deployment.workerToken);expect(input.revision).toBe(f.deployment.expected.revision);expect(input.nonce).toMatch(/^[a-f0-9]{64}$/);return {worker_boot_id:boot};}};
 return {f,node,deps,set row(v){row=v;},set boot(v){boot=v;}};
}
it('受信验收池仅开放独占槽1，fresh签名identity后绑定当前版本和grant',async()=>{
 const x=setup(),snapshot=await createLinuxRuntimeAdmission(x.deps)(x.f.deployment.machine_id,'safe');
 expect(snapshot).toMatchObject({verified:true,machine:x.f.deployment.machine_id,execution_version_id:x.node.id,execution_grant_id:x.f.challenge.grant_ids.safe,
  capacity:{ok:true,physical_base_slots:1,effective_base_slots:1}});expect(snapshot.expires_at-snapshot.captured_at).toBe(1000);
});
it('过期/撤销验收、boot重启、配置换代或未知容量拒绝；普通health不能放行',async()=>{
 for(const kind of ['expired','boot','policy','capacity','identity']){
  const x=setup();if(kind==='expired')x.row=null;if(kind==='boot')x.boot=randomUUID();if(kind==='policy')x.row={policy_digest:'f'.repeat(64)};
  if(kind==='capacity')x.node.profile.capacity=0;if(kind==='identity')x.deps.readIdentity=async()=>{throw Error('bad signature');};
  await expect(createLinuxRuntimeAdmission(x.deps)(x.f.deployment.machine_id,'safe')).rejects.toThrow();
 }
});
it('真实HTTP认证nonce身份回签必须匹配受信revision、pool与root进程boot',async()=>{
 const x=setup(),d=x.f.deployment;let boot=d.expected.worker_boot_id;
 const server=workerModule.createLinuxPoolServer({profile:d.pool,token:d.workerToken,revision:d.expected.revision,readWorkerBootId:()=>boot});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 x.deps.readIdentity=input=>canaryModule.readLinuxPoolIdentity({...input,fetchFn:(_url,opts)=>fetch('http://127.0.0.1:'+server.address().port+'/v1/pool/identity',opts)});
 try{
  expect((await createLinuxRuntimeAdmission(x.deps)(d.machine_id,'safe')).capacity.ok).toBe(true);
  boot=randomUUID();await expect(createLinuxRuntimeAdmission(x.deps)(d.machine_id,'safe')).rejects.toThrow('linux_script_admission_unavailable');
 }finally{await new Promise(r=>{server.close(r);server.closeAllConnections();});}
});
