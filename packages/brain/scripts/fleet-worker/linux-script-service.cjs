'use strict';
const fs=require('node:fs');
const {randomUUID,createHash}=require('node:crypto');
const {createLinuxScriptRuntime}=require('./linux-script-runtime.cjs');
const {createLinuxScriptLaunchGate}=require('./linux-script-launch-gate.cjs');
const {createLinuxScriptBridge}=require('./linux-script-bridge.cjs');
const {readInstalledFile}=require('./linux-pool-server.cjs');
const {validateLinuxPoolProfile}=require('./linux-pool-profile.cjs');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail=code=>{throw Error('linux_script_service_'+code);};
function createLinuxScriptService({key,pool,workerBootId,stateRoot,readDeployment,
 createRuntime=createLinuxScriptRuntime,createGate=createLinuxScriptLaunchGate}) {
 const trustedPool=validateLinuxPoolProfile(pool);let runtime=null,loaded=null,active=0,closed=false;
 if(!trustedPool.execution_budget_available||typeof readDeployment!=='function')fail('unavailable');
 function snapshot(){
  let input;try{input=structuredClone(readDeployment());}catch{/* 缺失配置只能清理历史运行。 */}
  const fallback={pool,worker_boot_id:workerBootId,execution_enabled:false,profiles:{}};
  if(!input||typeof input!=='object'||Array.isArray(input)||!input.pool||hash(input.pool)!==hash(pool)
   ||!input.profiles||typeof input.profiles!=='object'||Array.isArray(input.profiles))input=fallback;
  const digest=hash(input),deployment={...input,pool,worker_boot_id:workerBootId,
   execution_enabled:input.execution_enabled===true&&input.worker_boot_id===workerBootId};
  return {digest,deployment};
 }
 function current(){
  if(closed)fail('unavailable');const value=snapshot();
  if(loaded!==value.digest){
   if(active)fail('deployment_busy');
   const next=createRuntime({key,stateRoot,deployment:value.deployment,assertCanLaunch:createGate({workerBootId,
    configDigest:value.digest,readConfigDigest:()=>snapshot().digest})});
   runtime?.close();runtime=next;loaded=value.digest;
  }
  return runtime;
 }
 current(); // 重启即恢复持久deadline；不依赖后续HTTP请求。
 return {...Object.fromEntries(['start','inspect','cancel'].map(action=>[action,async input=>{
  const instance=current();active++;try{return await instance[action](input);}finally{active--;}
 }])),close(){closed=true;runtime?.close();}};
}
if(require.main===module){
 try {
  if(process.platform!=='linux'||process.getuid()!==0||process.argv.length!==2)fail('root_required');
  const read=(p,maxBytes)=>readInstalledFile(p,{mode:0o600,owner:0,maxBytes});
  const pool=JSON.parse(read('/etc/cecelia/script-pool.json',65536)),key=read('/etc/cecelia/script-execution.key',64);
  const workerBootId=randomUUID(),directory='/run/cecelia-script';
  const info=fs.lstatSync(directory);if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==0||(info.mode&0o022))fail('path_untrusted');
  const boot=fs.openSync(directory+'/worker-boot-id','wx',0o644);
  try{fs.writeFileSync(boot,workerBootId+'\n');fs.fchmodSync(boot,0o644);fs.fsyncSync(boot);}finally{fs.closeSync(boot);}
  const service=createLinuxScriptService({key,pool,workerBootId,stateRoot:'/var/lib/cecelia/script-runtime',
   readDeployment:()=>JSON.parse(read('/etc/cecelia/script-runtime.json',65536))});
  const server=createLinuxScriptBridge({key,runtime:service});
  server.on('error',()=>{service.close();process.stderr.write('linux_script_service_unavailable\n');process.exitCode=1;});
  server.listen(directory+'/bridge.sock',()=>{fs.chmodSync(directory+'/bridge.sock',0o660);});
  for(const name of ['SIGTERM','SIGINT'])process.once(name,()=>{service.close();server.close(()=>process.exit(0));server.closeAllConnections();});
 }catch{process.stderr.write('linux_script_service_unavailable\n');process.exitCode=1;}
}
module.exports={createLinuxScriptService};
