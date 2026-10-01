import {createHash} from 'node:crypto';
import path from 'node:path';
import permitModule from '../../scripts/fleet-worker/linux-script-permit.cjs';
import serverModule from '../../scripts/fleet-worker/linux-pool-server.cjs';
import {US_SCHEDULER_ID,UUID,HEX,exact} from './deployment.js';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail=()=>{throw Error('linux_script_authority_unavailable');};
const BINDINGS=['machine_id','owner_key','intent_id','launch_generation','config_digest','worker_id','worker_boot_id'];
function policy(machine,authority){
 const node=authority?.node,p=node?.profile?.linux_script,e=p?.expected;
 if(node?.platform!=='linux'||node.canonical_id!==machine||node.worker_id!==machine||!UUID.test(node.id??'')
  ||node.machine_registry_id===US_SCHEDULER_ID||!exact(p,['schema_version','expected','profiles','worker_credential','execution_credential'])
  ||p.schema_version!=='linux-script-authority/v1'
  ||!exact(e,['machine_registry_id','pool_config_digest','revision','host_boot_id','worker_boot_id','daemon_id'])
  ||e.machine_registry_id!==node.machine_registry_id||e.worker_boot_id!==node.worker_boot_id
  ||!p.profiles||typeof p.profiles!=='object'||Array.isArray(p.profiles)||Object.keys(p.profiles).length===0
  ||Object.entries(p.profiles).some(([k,v])=>! /^[a-z0-9][a-z0-9_-]{0,63}$/.test(k)||!HEX.test(v??'')))fail();
 return {node,p,e};
}
/** 凭据引用来自受信版本，不接受任务body自报的文件、endpoint或expected。 */
export function createLinuxScriptAuthorization({readProtected=serverModule.readInstalledFile,owner=process.getuid?.()??0}={}) {
 function credential(value){
  if(!exact(value,['file','binding'])||!path.isAbsolute(value.file??'')||!HEX.test(value.binding??''))fail();
  const secret=readProtected(value.file,{mode:0o600,owner,maxBytes:64});
  if(!HEX.test(secret??'')||value.binding!==digest({file:value.file,token_digest:digest(secret)}))fail();
  return secret;
 }
 function capabilities(machine,authority){
  const {node,p}=policy(machine,authority);if(node.state!=='active'||node.profile.execution!==true)fail();
  return {machine_id:machine,worker_id:node.worker_id,worker_boot_id:node.worker_boot_id,profiles:{...p.profiles}};
 }
 async function prepare(machine,action,input,authority){
  const {node,p,e}=policy(machine,authority),row=authority.reservation,grant=authority.grant;
  if(!['start','inspect','cancel'].includes(action)||row?.owner_kind!=='script'||row.id!==input.reservation_id
   ||BINDINGS.some(k=>row[k]!==input[k])||row.execution_version_id!==node.id||row.worker_id!==node.worker_id||row.worker_boot_id!==node.worker_boot_id
   ||!UUID.test(row.execution_grant_id??'')||grant?.id!==row.execution_grant_id||grant.node_version_id!==node.id
   ||grant.surface!=='managed_script'||grant.provider!=='script'||!Object.hasOwn(p.profiles,grant.profile_id))fail();
  if(action==='start'){
   if(node.state!=='active'||node.profile.execution!==true||grant.state!=='active'||!['launching','running'].includes(row.status)
    ||input.job?.profile!==grant.profile_id||row.config_digest!==digest({job:input.job,profile_digest:p.profiles[grant.profile_id]}))fail();
  }
  const bound={execution_version_id:node.id,execution_grant_id:grant.id,profile_id:grant.profile_id};
  if(Object.entries(bound).some(([k,v])=>Object.hasOwn(input,k)&&input[k]!==v)||Object.hasOwn(input,'permit'))fail();
  const workerToken=credential(p.worker_credential),responseKey=credential(p.execution_credential);if(workerToken===responseKey)fail();
  const body={...input,...bound},expected={...e,execution_version_id:node.id,execution_grant_id:grant.id,profile_digest:p.profiles[grant.profile_id]};
  return {body:{...body,permit:permitModule.signLinuxScriptPermit({key:responseKey,expected,action,body})},workerToken,responseKey};
 }
 return {capabilities,prepare};
}
