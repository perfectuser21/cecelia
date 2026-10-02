import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import serverModule from '../../scripts/fleet-worker/linux-pool-server.cjs';
import {normalizeDeployment,exact,error,HEX} from './deployment.js';
import {normalizeRuntimeDeployment} from './runtime-deployment.js';
/** 仅可信接入后台调用；无HTTP写配置入口。原始secret不进入部署文档或回执。 */
export function createLinuxDeploymentWriter({env=process.env,owner=process.getuid?.()??0,pathRoot='/',readProtected=serverModule.readInstalledFile}={}){
 const fail=()=>{throw error('linux_pool_deployment_write_unavailable');};
 function parent(filename){
  let p=path.dirname(filename);
  for(;;){const s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==(pathRoot==='/'?0:owner)||(s.mode&0o022))fail();
   if(p===pathRoot)return;const up=path.dirname(p);if(up===p)fail();p=up;}
 }
 function normalize(kind,input){
  const secret=p=>{if(!path.isAbsolute(p??''))fail();return readProtected(p,{mode:0o600,owner,maxBytes:64});};
  return kind==='pool'?normalizeDeployment(input,secret(input.credential_file)):
   normalizeRuntimeDeployment(input,secret(input.worker_credential_file),secret(input.execution_credential_file));
 }
 function write(kind,input,expectedDigest){
  if(expectedDigest!==null&&!HEX.test(expectedDigest??''))throw error('linux_pool_deployment_write_conflict');
  const file=env[kind==='pool'?'CECELIA_LINUX_POOL_DEPLOYMENTS_FILE':'CECELIA_LINUX_SCRIPT_DEPLOYMENTS_FILE'];
  if(!path.isAbsolute(file??'')||path.basename(file).startsWith('.'))fail();
  let acquired=false,temp,fd;const lock=file+'.lock';
  try{
   parent(file);fs.mkdirSync(lock,{mode:0o700});acquired=true;
   const next=normalize(kind,input),machineId=next.expected.machine_registry_id;
   let document={schema_version:1,deployments:[]};
   try{fs.lstatSync(file);document=JSON.parse(readProtected(file,{mode:0o600,owner,maxBytes:65536}));}catch(e){if(e.code!=='ENOENT')throw e;}
   if(!exact(document,['schema_version','deployments'])||document.schema_version!==1||!Array.isArray(document.deployments))fail();
   const identity=r=>kind==='pool'?r.profile?.machine_registry_id:r.pool?.machine_registry_id;
   const matches=document.deployments.filter(r=>identity(r)===machineId);if(matches.length>1)fail();
   const previous=matches[0]?normalize(kind,matches[0]).policyDigest:null;
   if(previous===next.policyDigest)return {machine_registry_id:machineId,policy_digest:next.policyDigest};
   if(previous!==expectedDigest)throw error('linux_pool_deployment_write_conflict');
   document.deployments=[...document.deployments.filter(r=>identity(r)!==machineId),structuredClone(input)];
   const raw=JSON.stringify(document);if(Buffer.byteLength(raw)>65536)fail();
   parent(file);temp=file+'.'+randomUUID();fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,raw);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
   fs.renameSync(temp,file);temp=null;const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
   return {machine_registry_id:machineId,policy_digest:next.policyDigest};
  }catch(e){if(e.message==='linux_pool_deployment_write_conflict')throw e;fail();}
  finally{if(fd!==undefined)fs.closeSync(fd);if(temp)try{fs.unlinkSync(temp);}catch{}if(acquired)fs.rmdirSync(lock);}
 }
 return {pool:(input,expectedDigest)=>write('pool',input,expectedDigest),runtime:(input,expectedDigest)=>write('runtime',input,expectedDigest)};
}
