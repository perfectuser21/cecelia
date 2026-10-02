import {createHash} from 'node:crypto';
import path from 'node:path';
import poolModule from '../../scripts/fleet-worker/linux-pool-profile.cjs';
import serverModule from '../../scripts/fleet-worker/linux-pool-server.cjs';
import scriptModule from '../../scripts/fleet-worker/script-runner.cjs';
import {UUID,HEX,exact,error} from './deployment.js';
export const runtimeDigest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function normalizeRuntimeDeployment(input,workerToken,key){
 try{
  if(!exact(input,['pool','revision','host_boot_id','worker_boot_id','daemon_id','profiles','worker_credential_file','execution_credential_file','parent_task_id']))throw Error();
  const pool=poolModule.validateLinuxPoolProfile(input.pool);
  if(!pool.execution_budget_available||!HEX.test(key??'')||!HEX.test(workerToken??'')||key===workerToken||!UUID.test(input.parent_task_id??'')
   ||!/^[a-f0-9]{40}$/.test(input.revision??'')||!UUID.test(input.host_boot_id??'')||!UUID.test(input.worker_boot_id??'')
   ||typeof input.daemon_id!=='string'||!input.daemon_id||input.daemon_id.length>256
   ||!path.isAbsolute(input.worker_credential_file??'')||!path.isAbsolute(input.execution_credential_file??'')
   ||!input.profiles||typeof input.profiles!=='object'||Array.isArray(input.profiles)||Object.keys(input.profiles).length<1||Object.keys(input.profiles).length>32)throw Error();
  for(const [name,entry] of Object.entries(input.profiles)){
   if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)||!exact(entry,['profile','image_id'])||!/^sha256:[a-f0-9]{64}$/.test(entry.image_id??''))throw Error();
   const p=scriptModule.validateScriptProfile(entry.profile);
   if(p.cpus>pool.pool.cpu_cores||!Number.isSafeInteger(p.cpus*1e9)||p.memoryBytes>pool.pool.memory_bytes||p.pidsLimit>pool.pool.pids_limit||p.cwd.includes('\0'))throw Error();
  }
  const expected={machine_registry_id:pool.machine_registry_id,pool_config_digest:pool.config_digest,revision:input.revision,
   host_boot_id:input.host_boot_id,worker_boot_id:input.worker_boot_id,daemon_id:input.daemon_id};
  const credential=(file,token)=>({file,binding:runtimeDigest({file,token_digest:runtimeDigest(token)})});
  const authority={schema_version:'linux-script-authority/v1',expected,profiles:Object.fromEntries(Object.entries(input.profiles).map(([id,e])=>[id,runtimeDigest(e.profile)])),
   worker_credential:credential(input.worker_credential_file,workerToken),execution_credential:credential(input.execution_credential_file,key)};
  const host=pool.endpoint_host.includes(':')?'['+pool.endpoint_host+']':pool.endpoint_host;
  const publicPolicy={expected,machine_id:pool.machine_id,endpoint:`http://${host}:5231`,pool:structuredClone(input.pool),profiles:structuredClone(input.profiles),authority,parent_task_id:input.parent_task_id};
  return {...publicPolicy,policyDigest:runtimeDigest(publicPolicy),workerToken,key};
 }catch{throw error('linux_pool_runtime_deployment_invalid');}
}
export function createRuntimeDeploymentReader({env=process.env,readProtected=serverModule.readInstalledFile,owner=process.getuid?.()??0}={}){
 return async machineId=>{
  try{
   const file=env.CECELIA_LINUX_SCRIPT_DEPLOYMENTS_FILE;if(!path.isAbsolute(file??''))throw Error();
   const records=JSON.parse(readProtected(file,{mode:0o600,owner,maxBytes:65536}));
   if(!exact(records,['schema_version','deployments'])||records.schema_version!==1||!Array.isArray(records.deployments))throw Error();
   const matches=records.deployments.filter(r=>r.pool?.machine_registry_id===machineId);if(matches.length!==1)throw Error();
   const record=matches[0],secret=p=>{if(!path.isAbsolute(p??''))throw Error();return readProtected(p,{mode:0o600,owner,maxBytes:64});};
   return normalizeRuntimeDeployment(record,secret(record.worker_credential_file),secret(record.execution_credential_file));
  }catch{throw error('linux_pool_runtime_deployment_unavailable');}
 };
}
