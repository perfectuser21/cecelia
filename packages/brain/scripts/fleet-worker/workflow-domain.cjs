'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {assertProfile,profileDigest}=require('./workflow-profile.cjs');
// ESM依赖按realpath缓存；同一路径已加载的声明源不能在本进程内换字节。
const loadedSources=new Map();
const unknown=reason=>Object.assign(Error(reason),{executionStopped:false,externalEffect:'unknown'});

// Promise超时不是停止证明。所有超时保留执行权；domain close还须显式读回资源已停止。
function bounded(call,deadline,{onTimeout}={}){
 if(!Number.isFinite(deadline)||Date.now()>=deadline){onTimeout?.();return Promise.reject(unknown('workflow_domain_timeout'));}
 let timer;
 const work=Promise.resolve().then(call);
 return Promise.race([work,new Promise((_,reject)=>{
  timer=setTimeout(()=>{onTimeout?.();reject(unknown('workflow_domain_timeout'));},Math.max(0,deadline-Date.now()));
 })]).finally(()=>clearTimeout(timer));
}
async function loadWorkflowDomain({profile,originalProfile=profile,identity,runDirectory,controller,startedAt,recordEvidence}){
 assertProfile(profile,identity.mode);
 assertProfile(originalProfile,identity.mode);
 if(profileDigest(originalProfile)!==identity.profile_sha256)throw Error('workflow_domain_profile_identity_conflict');
 const fixedProfile=structuredClone(originalProfile);
 const spec=fixedProfile.domain_adapter;
 if(!spec)return null;
 const sources=Object.entries(fixedProfile.files).map(([entry,sha])=>[fs.realpathSync(path.join(fixedProfile.cwd,entry)),sha]);
 for(const [source,sha] of sources){if(loadedSources.has(source)&&loadedSources.get(source)!==sha)throw Error('workflow_domain_source_cache_conflict');}
 for(const [source,sha] of sources)loadedSources.set(source,sha);
 const deadline_ms=startedAt+spec.budget.max_duration_s*1000;
 const cleanup_deadline_ms=deadline_ms+spec.budget.cleanup_grace_s*1000;
 fs.mkdirSync(runDirectory,{recursive:true,mode:0o700});
 const url=pathToFileURL(path.resolve(profile.cwd,spec.entry));url.searchParams.set('sha256',profile.files[spec.entry]);
 const module=await bounded(()=>import(url.href),deadline_ms,{onTimeout:()=>controller.abort()});
 assertProfile(profile,identity.mode);
 if(typeof module[spec.export_name]!=='function')throw Error('workflow_domain_factory_required');
 const domain=await bounded(()=>module[spec.export_name]({identity:structuredClone(identity),profile:structuredClone(fixedProfile),runDirectory,
  signal:controller.signal,deadline_ms,cleanup_deadline_ms,recordEvidence}),deadline_ms,{onTimeout:()=>controller.abort()});
 if(!domain||['executeActivity','checkActivity','validateWorkflow','close'].some(k=>typeof domain[k]!=='function'))throw Error('workflow_domain_callbacks_required');
 let pending=0,closed=false;
 const invoke=(method,args,deadline)=>{
  assertProfile(profile,identity.mode);
  return bounded(()=>{pending++;return Promise.resolve().then(()=>domain[method](...args)).finally(()=>pending--);},deadline,{onTimeout:()=>controller.abort()});
 };
 const execute=(method,a,input,options)=>invoke(method,[structuredClone(a),input,options],Math.min(a.runtime.phase==='finalize'?cleanup_deadline_ms:deadline_ms,Date.now()+a.budget.max_duration_s*1000));
 return {
  ...(typeof domain.onEvent==='function'?{onEvent:(...args)=>closed?undefined:invoke('onEvent',args,cleanup_deadline_ms)}:{}),
  executeActivity:(...args)=>execute('executeActivity',...args),
  ...(typeof domain.recoverActivity==='function'?{recoverActivity:(a,input,options)=>{
   if(options.failure?.external_effect==='unknown'&&profile.recoveries?.[a.key]?.readback_only!==true)return Promise.reject(Error('workflow_recovery_readback_required'));
   return execute('recoverActivity',a,input,options);
  }}:{}),
  ...(typeof domain.prepareInput==='function'?{prepareInput:(...args)=>invoke('prepareInput',[structuredClone(args[0]),args[1]],args[0].runtime.phase==='finalize'?cleanup_deadline_ms:deadline_ms)}:{}),
  ...(typeof domain.canFinalize==='function'?{canFinalize:(...args)=>invoke('canFinalize',[structuredClone(args[0]),structuredClone(args[1])],cleanup_deadline_ms)}:{}),
  checkActivity:(a,_result,options)=>({scope,definition,receipt,result,phase,signal})=>invoke('checkActivity',[structuredClone(a),result,{...options,input:options.input===undefined?undefined:structuredClone(options.input),receipt,phase,signal:a.runtime.phase==='finalize'?undefined:signal,scope,acceptance:structuredClone(definition.acceptance)}],Math.min(a.runtime.phase==='finalize'?cleanup_deadline_ms:deadline_ms,Date.now()+(options.remaining_ms??30000))),
  evaluateScope:({scope,definition,receipt,signal})=>invoke('validateWorkflow',[structuredClone(fixedProfile),receipt,{scope,signal,acceptance:structuredClone(definition.acceptance)}],Math.min(scope==='cleanup'?cleanup_deadline_ms:deadline_ms,Date.now()+(definition.timeout_s??30)*1000)),
  close:async()=>{
   if(closed)throw Error('workflow_domain_already_closed');closed=true;
   const proof=await bounded(()=>domain.close(),cleanup_deadline_ms);
   if(proof?.execution_stopped!==true||pending!==0)throw unknown('workflow_domain_close_unconfirmed');
   return proof;
  },
 };
}
module.exports={loadWorkflowDomain};
