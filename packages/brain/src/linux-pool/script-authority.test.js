import {describe,it,expect} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {createLinuxScriptAuthorization} from './script-authority.js';
import permit from '../../scripts/fleet-worker/linux-script-permit.cjs';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function fixture(){
 const rootKey='a'.repeat(64),workerToken='b'.repeat(64),profileDigest='c'.repeat(64);
 const credential=(file,value)=>({file,binding:digest({file,token_digest:digest(value)})});
 const expected={machine_registry_id:'71d632df-252a-4991-ad6b-3647fbbea9f7',pool_config_digest:'d'.repeat(64),revision:'e'.repeat(40),host_boot_id:randomUUID(),worker_boot_id:randomUUID(),daemon_id:'daemon-fixed'};
 const node={id:randomUUID(),platform:'linux',machine_registry_id:expected.machine_registry_id,canonical_id:'hk-vps',worker_id:'hk-vps',worker_boot_id:expected.worker_boot_id,state:'active',profile:{execution:true,linux_script:{schema_version:'linux-script-authority/v1',expected,profiles:{safe:profileDigest},worker_credential:credential('/etc/cecelia/worker.token',workerToken),execution_credential:credential('/etc/cecelia/root.key',rootKey)}}};
 const reservation={id:randomUUID(),owner_kind:'script',machine_id:'hk-vps',owner_key:'script-'+randomUUID()+'-a1',intent_id:randomUUID(),launch_generation:1,worker_id:'hk-vps',worker_boot_id:expected.worker_boot_id,execution_version_id:node.id,execution_grant_id:randomUUID(),status:'launching'};
 const grant={id:reservation.execution_grant_id,node_version_id:node.id,surface:'managed_script',provider:'script',profile_id:'safe',state:'active'};
 const job={profile:'safe',cmd:'printf ok',timeout_sec:5,env:{}};reservation.config_digest=digest({job,profile_digest:profileDigest});
 const body={reservation_id:reservation.id,machine_id:reservation.machine_id,owner_key:reservation.owner_key,intent_id:reservation.intent_id,launch_generation:1,config_digest:reservation.config_digest,worker_id:reservation.worker_id,worker_boot_id:reservation.worker_boot_id,request_nonce:randomUUID(),job};
 const options={readProtected:file=>file.endsWith('root.key')?rootKey:workerToken};
 return {rootKey,workerToken,profileDigest,node,reservation,grant,body,options};
}
describe('Brain独立root执行许可',()=>{
 it('预约/版本/grant来自DB authority，可信文件独立key签permit；普通Worker token不可伪造',async()=>{
  const f=fixture(),auth=createLinuxScriptAuthorization(f.options),prepared=await auth.prepare('hk-vps','start',f.body,f);
  expect(prepared.workerToken).toBe(f.workerToken);expect(prepared.responseKey).toBe(f.rootKey);
  const {permit:signature,...body}=prepared.body,expected={...f.node.profile.linux_script.expected,execution_version_id:f.node.id,execution_grant_id:f.grant.id,profile_digest:f.profileDigest};
  expect(()=>permit.verifyLinuxScriptPermit({key:f.rootKey,expected,action:'start',body,permit:signature})).not.toThrow();
  expect(()=>permit.verifyLinuxScriptPermit({key:f.workerToken,expected,action:'start',body,permit:signature})).toThrow();
  expect(JSON.stringify(prepared.body)).not.toContain(f.rootKey);
 });
 it.each(['binding','worker-key','grant','version','job','boot','released','identity','us'])('%s错误时不签发',async kind=>{
  const f=fixture();
  if(kind==='binding')f.options.readProtected=()=> 'f'.repeat(64);
  if(kind==='worker-key')f.node.profile.linux_script.execution_credential=f.node.profile.linux_script.worker_credential;
  if(kind==='grant')f.grant.id=randomUUID();if(kind==='version')f.reservation.execution_version_id=randomUUID();
  if(kind==='job')f.body.job.cmd='evil';if(kind==='boot')f.body.worker_boot_id=randomUUID();
  if(kind==='released')f.reservation.status='released';if(kind==='identity')f.body.owner_key='script-foreign-a1';
  if(kind==='us')f.node.profile.linux_script.expected.machine_registry_id='1a379d80-ad36-47d3-88ba-e545ab299a54';
  await expect(createLinuxScriptAuthorization(f.options).prepare('hk-vps','start',f.body,f)).rejects.toThrow();
 });
 it('历史撤销版本/grant仍能签清理，但不能再签start',async()=>{
  const f=fixture();f.node.state='revoked';f.grant.state='revoked';f.reservation.status='cleanup_pending';delete f.body.job;f.body.challenge=randomUUID();f.body.container_id='a'.repeat(64);
  const auth=createLinuxScriptAuthorization(f.options);expect((await auth.prepare('hk-vps','cancel',f.body,f)).body.profile_id).toBe('safe');
  await expect(auth.prepare('hk-vps','start',f.body,f)).rejects.toThrow();
 });
 it('Linux能力只从active受信目录读profile摘要，不从Worker接收权限或凭据',()=>{
  const f=fixture(),auth=createLinuxScriptAuthorization(f.options);
  expect(auth.capabilities('hk-vps',f)).toEqual({machine_id:'hk-vps',worker_id:'hk-vps',worker_boot_id:f.node.worker_boot_id,execution_version_id:f.node.id,policy_digest:f.node.config_hash,profiles:{safe:f.profileDigest}});
  f.node.state='pending';expect(()=>auth.capabilities('hk-vps',f)).toThrow();
 });
});
