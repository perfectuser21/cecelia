import { createHash } from 'node:crypto';
import path from 'node:path';
import profileModule from '../../scripts/fleet-worker/linux-pool-profile.cjs';
import serverModule from '../../scripts/fleet-worker/linux-pool-server.cjs';
export const ONBOARDING_CONTROL_ROOT='/run/cecelia-fleet-control';
export const US_SCHEDULER_ID='1a379d80-ad36-47d3-88ba-e545ab299a54';
export const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
export const HEX=/^[a-f0-9]{64}$/;
export const error=code=>Object.assign(Error(code),{status:409});
export function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));}
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** 部署文件由可信安装控制面登记，凭据文件由1Password同步；HTTP请求不能提供任一权威字段。 */
export function normalizeDeployment(input,token){
 try{
  if(!exact(input,['profile','revision','host_boot_id','worker_boot_id','daemon_id','image_id','script_profiles','credential_file']))throw Error();
  const p=profileModule.validateLinuxPoolProfile(input.profile);
  if(!p.execution_budget_available||!HEX.test(token??'')||!/^[a-f0-9]{40}$/.test(input.revision??'')
    ||!UUID.test(input.host_boot_id??'')||!UUID.test(input.worker_boot_id??'')
    ||typeof input.daemon_id!=='string'||!input.daemon_id||input.daemon_id.length>256
    ||!/^sha256:[a-f0-9]{64}$/.test(input.image_id??'')||!path.isAbsolute(input.credential_file??'')
    ||!Array.isArray(input.script_profiles)||!input.script_profiles.length||input.script_profiles.length>32
    ||new Set(input.script_profiles).size!==input.script_profiles.length||input.script_profiles.some(v=>typeof v!=='string'||! /^[a-z0-9][a-z0-9_-]{0,63}$/.test(v)))throw Error();
  const host=p.endpoint_host.includes(':')?'['+p.endpoint_host+']':p.endpoint_host;
  const expected={machine_registry_id:p.machine_registry_id,machine_id:p.machine_id,revision:input.revision,config_digest:p.config_digest,
   host_boot_id:input.host_boot_id,worker_boot_id:input.worker_boot_id,daemon_id:input.daemon_id,image_id:input.image_id,
   endpoint:`http://${host}:5231`,pool:p.pool,script_profiles:[...input.script_profiles].sort(),
   credential_binding:digest({file:input.credential_file,token_digest:digest(token)})};
  return {expected,policyDigest:digest(expected),token};
 }catch{throw error('linux_pool_deployment_invalid');}
}
export function createDeploymentReader({env=process.env,readProtected=serverModule.readInstalledFile,owner=process.getuid?.()??0}={}){
 return async machineId=>{
  try{
   const filename=env.CECELIA_LINUX_POOL_DEPLOYMENTS_FILE;
   if(!path.isAbsolute(filename??''))throw Error();
   const records=JSON.parse(readProtected(filename,{mode:0o600,owner,maxBytes:65536}));
   if(!exact(records,['schema_version','deployments'])||records.schema_version!==1||!Array.isArray(records.deployments))throw Error();
   const found=records.deployments.filter(p=>p.profile?.machine_registry_id===machineId);if(found.length!==1)throw Error();
   const record=found[0];if(!path.isAbsolute(record.credential_file??''))throw Error();
   const token=readProtected(record.credential_file,{mode:0o600,owner,maxBytes:64});
   return normalizeDeployment(record,token);
  }catch{throw error('linux_pool_deployment_unavailable');}
 };
}
