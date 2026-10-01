import {randomBytes} from 'node:crypto';
import canaryModule from '../../scripts/fleet-worker/linux-pool-canary.cjs';
import poolModule from '../../scripts/fleet-worker/linux-pool-profile.cjs';
import {directory} from '../execution-directory/directory.js';
import {authorize} from '../execution-directory/store.js';
import {createRuntimeDeploymentReader} from './runtime-deployment.js';
export function createLinuxRuntimeAdmission({pool,readDeployment=createRuntimeDeploymentReader(),readIdentity=canaryModule.readLinuxPoolIdentity,authorizeRequest=authorize}={}){
 return async(machine,profileId)=>authorizeRequest(pool,{snapshotVersion:directory.current()?.version,machineId:machine,surface:'managed_script',provider:'script',profileId},async({node,grant},db)=>{
  const fail=()=>{throw Error('linux_script_admission_unavailable');};
  if(node.platform!=='linux'||node.profile?.execution!==true||node.profile.capacity!==1)fail();
  const d=await readDeployment(node.profile.linux_script.expected.machine_registry_id);
  if(d.machine_id!==machine||!d.profiles[profileId])fail();
  const row=(await db.query(`SELECT policy_digest FROM linux_script_authorizations WHERE execution_version_id=$1 AND state='active'
   AND authorization_expires_at>clock_timestamp() AND grant_ids->>$2=$3`,[node.id,profileId,grant.id])).rows[0];
  if(!row||row.policy_digest!==d.policyDigest)fail();
  const identity=await readIdentity({profile:poolModule.validateLinuxPoolProfile(d.pool),token:d.workerToken,revision:d.expected.revision,nonce:randomBytes(32).toString('hex')});
  if(identity.worker_boot_id!==d.expected.worker_boot_id)fail();
  // 逻辑独占槽不把观测值换算为授权；真实动态资源与维护闸仍在root每次create/start复核。
  const captured_at=Date.now();return {verified:true,machine,captured_at,expires_at:captured_at+1000,execution_version_id:node.id,execution_grant_id:grant.id,
   worker_boot_id:d.expected.worker_boot_id,policy_digest:d.policyDigest,capacity:{ok:true,physical_base_slots:1,effective_base_slots:1,available:1}};
 });
}
