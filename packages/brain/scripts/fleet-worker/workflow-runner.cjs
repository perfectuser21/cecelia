'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {protectedRead,processBirth,sameProcess,validResult}=require('../../src/orchestrator/activity-supervisor-state.cjs');
const {assertProfile,profileDigest,UUID}=require('./workflow-profile.cjs');
function persist(file,value){
 const tmp=file+'.'+randomUUID()+'.tmp';let fd;
 try{fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(tmp,file);const d=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}}
 finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
const ACTIVE=new Set(['starting','running','recovering','validating','unknown']);
function createWorkflowRunner({stateRoot,machineId,profiles={},assertCanLaunch,assertLocalResources,createRecorder,brainUrl,headers={}}){
 if(!path.isAbsolute(stateRoot)||typeof assertCanLaunch!=='function'||typeof assertLocalResources!=='function')throw Error('workflow_configuration_required');
 fs.mkdirSync(stateRoot,{recursive:true,mode:0o700});
 const active=new Map(),recorders=new Map();
 let flushQueue=Promise.resolve();
 const file=id=>path.join(stateRoot,id+'.json');
 const read=id=>fs.existsSync(file(id))?JSON.parse(fs.readFileSync(file(id),'utf8')):null;
 const save=s=>{if(read(s.identity.run_id)?.cancel_requested===true)s.cancel_requested=true;persist(file(s.identity.run_id),s);};
 const eligible=p=>p?.cleanup_required===false&&Array.isArray(p.resources)&&p.resources.length===0&&!p.domain_adapter&&p.contract?.activities?.length===1&&p.contract.activities[0].runtime.phase==='source'&&p.contract.activities[0].runtime.interactive!==true&&p.contract.activities[0].runtime.detached!==true&&(p.contract.activities[0].runtime.max_attempts??1)===1&&p.contract.activities[0].runtime.recovery_safe!==true&&p.metadata?.[p.contract.activities[0].key]?.executor_kind==='agent';
 const supervisorDirectory=s=>path.join(stateRoot,s.identity.run_id,'activity-supervisor');
 const ownerFile=path.join(stateRoot,'execution.lock','owner.json');
 function resumable(s){
  try{
   if(s.status==='unknown')return false;
   protectedRead(file(s.identity.run_id));
   const c=s.continuation,p=profiles[s.identity.profile],a=s.profile.contract.activities[0];
   if(!eligible(s.profile)||!eligible(p)||s.machine_id!==machineId||s.cancel_requested||s.commander_pending!==false||s.commander_unknown||!c||c.consumed||!Number.isFinite(c.checkpoint.deadline)||c.checkpoint.deadline<=Date.now()||c.checkpoint.attempt!==1)return false;
   if(profileDigest(p)!==s.identity.profile_sha256||profileDigest(s.profile)!==c.binding.runtime_profile_sha256||profileDigest(c.checkpoint)!==c.binding.checkpoint_sha256||c.binding.run_id!==s.identity.run_id||c.binding.task_id!==s.identity.task_id||c.binding.profile_sha256!==s.identity.profile_sha256||c.binding.activity!==a.key||c.binding.source_sha256!==s.profile.files[a.runtime.entry])return false;
   assertProfile(s.profile,s.identity.mode);assertProfile(p,s.identity.mode);
   const owner=protectedRead(ownerFile,2);if(owner.run_id!==s.identity.run_id||typeof owner.birth!=='string')return false;
   const m=protectedRead(path.join(supervisorDirectory(s),'manifest.json'),3);
   if(m.protocol!=='activity-supervisor/v1'||profileDigest(m.binding)!==profileDigest(c.binding)||m.deadline!==c.checkpoint.deadline||!m.nonce)return false;
   const result=path.join(supervisorDirectory(s),'result.json');
   const running=fs.existsSync(result)||sameProcess(m.pid,m.birth);
   if(fs.existsSync(result)){if(!validResult(protectedRead(result,3),m))return false;}else if(!running)return false;
   if(fs.existsSync(path.join(supervisorDirectory(s),'cancel.json')))return false;
   return true;
  }catch{return false;}
 }
 const recoverable=[];
 // 仅接回落盘的同一次执行；缺少证明的旧执行继续占用 unknown。
 for(const name of fs.readdirSync(stateRoot).filter(n=>n.endsWith('.json')&&UUID.test(n.replace(/\.json$/,'')))){
  const s=read(name.replace(/\.json$/,''));if(!s||!ACTIVE.has(s.status))continue;
  if(resumable(s)){
   const owner=protectedRead(ownerFile,2);if(sameProcess(owner.pid,owner.birth))continue;
   try{fs.mkdirSync(path.join(stateRoot,'execution.lock','resume-'+owner.pid),{mode:0o700});}catch{s.status='unknown';s.reason='worker_restarted_execution_unknown';save(s);continue;}
   persist(ownerFile,{run_id:s.identity.run_id,pid:process.pid,birth:processBirth(process.pid)});s.status='recovering';save(s);recoverable.push(s);
  }else{s.status='unknown';s.reason='worker_restarted_execution_unknown';save(s);}
 }
 const assertIdentity=body=>{if(!UUID.test(body?.run_id??'')||!UUID.test(body?.task_id??''))throw Error('workflow_identity_invalid');};
 const existing=body=>{assertIdentity(body);const s=read(body.run_id);if(!s||s.identity.task_id!==body.task_id)throw Error('workflow_identity_not_found');return s;};
 const makeRecorder=async s=>{
  if(recorders.has(s.identity.run_id))return recorders.get(s.identity.run_id);
  if(createRecorder){const r=createRecorder(s);recorders.set(s.identity.run_id,r);return r;}
  const {createWorkflowRecorder}=await import('../../src/orchestrator/workflow-recorder.js');
  const r=createWorkflowRecorder({root:path.join(stateRoot,s.identity.run_id),runId:s.identity.run_id,taskId:s.identity.task_id,machineId,profileDigest:s.identity.profile_sha256,mode:s.identity.mode,metadata:s.profile.metadata,brainUrl,headers});
  recorders.set(s.identity.run_id,r);return r;
 };
 const project=async s=>({run_id:s.identity.run_id,task_id:s.identity.task_id,machine_id:machineId,status:s.status,mode:s.identity.mode,profile_sha256:s.identity.profile_sha256,progress:s.progress??null,validation:s.validation??null,writeback:s.writeback??{pending:null},reason:s.reason??null,cancel_requested:s.cancel_requested===true,execution_state:s.execution_state??null,commander_status:s.commander_status??'unavailable',cleanup_required:s.profile?.cleanup_required!==false,execution_unknown:s.execution_unknown??null});
 async function execute(s,recorder,controller,resuming=false){
  let commander,domain,domainClosed=false,domainTimer,eventCursor=resuming?Math.max(s.event_cursor??0,s.continuation.runner_cursor,s.progress?.cursor??0):0,currentReceipt={activities:[]};
  const closeDomain=async()=>{if(!domain||domainClosed)return;domainClosed=true;try{await domain.close();}catch(error){s.execution_unknown=true;currentReceipt.execution_unknown=true;delete s.pending_terminal_status;throw error;}};
  const observe=async(event,receipt=currentReceipt)=>{
   if(event.event_type==='COMMANDER_REQUEST'){s.commander_pending=true;save(s);}
   if(event.event_type==='COMMANDER_EXCHANGE'){s.commander_pending=false;s.commander_facts??={aborted:[],counts:{},exchanges:0};s.commander_facts.exchanges++;if(event.accepted&&event.activity){s.commander_facts.counts[event.activity]=(s.commander_facts.counts[event.activity]??0)+1;if(event.action?.action==='abort')s.commander_facts.aborted.push(event.activity);}save(s);}
   if(event.event_type==='COMMANDER_UNAVAILABLE'&&s.profile.commander){s.commander_unknown=true;save(s);}
   currentReceipt=receipt;const numbered={...event,cursor:++eventCursor};
   // 先保留游标；Recorder 已落盘但 progress 未写入时崩溃，也不能复用该事件身份。
   s.event_cursor=eventCursor;save(s);
   await recorder.onEvent(numbered,receipt);await domain?.onEvent?.(structuredClone(numbered),structuredClone(receipt));s.commander_status=commander?.status??'unavailable';
   s.progress={observed_at:new Date().toISOString(),cursor:numbered.cursor,event_type:numbered.event_type,activity:numbered.activity??null,item:numbered.item??null,attempt:numbered.attempt??null};save(s);
  };
  try{
   const {runActivityContract}=await import('../../src/orchestrator/activity-runtime.js');
   const {callActivityProcess}=await import('../../src/orchestrator/activity-process.js');
   const {validateWorkflow,validateActivity}=await import('../../src/orchestrator/workflow-validator.js');
   const {createCommanderBridge}=await import('../../src/orchestrator/runner-commander-bridge.js');
   const {createCommanderTransport,createOpenClawCommanderTransport}=await import('../../src/orchestrator/runner-commander-transport.js');
   if(s.profile.domain_adapter){
    const {loadWorkflowDomain}=require('./workflow-domain.cjs');
    const deadline=s.domain_started_at_ms+s.profile.domain_adapter.budget.max_duration_s*1000;
    domainTimer=setTimeout(()=>controller.abort(),Math.max(0,deadline-Date.now()));
    domain=await loadWorkflowDomain({profile:s.profile,originalProfile:profiles[s.identity.profile],identity:{...s.identity,machine_id:machineId},runDirectory:path.join(stateRoot,s.identity.run_id),controller,startedAt:s.domain_started_at_ms,recordEvidence:event=>observe(event)});
   }
   const cp=s.profile.commander;
   const baseTransport=(cp?.kind==='openclaw'?createOpenClawCommanderTransport:createCommanderTransport)({profile:cp,cwd:s.profile.cwd,files:s.profile.files});
   const transport=request=>baseTransport({...request,workflow:s.profile.contract.workflow,profile_sha256:s.identity.profile_sha256,
    activity_contract:request.activity?{...s.profile.contract.activities.find(a=>a.key===request.activity),questions:s.profile.metadata[request.activity]?.questions}:null});
   if(baseTransport.reconcile)transport.reconcile=request=>baseTransport.reconcile(request);
   commander=createCommanderBridge({transport,onEvent:observe,run_id:s.identity.run_id,brief:s.profile.brief??{purpose:s.profile.contract.workflow},rules:s.profile.rules??[],budget:cp?.budget??{}});
   if(resuming){const facts=s.commander_facts??{aborted:[],counts:{}};commander={status:s.commander_status,notify:async()=>({action:'none'}),sleep:async()=>{},isAborted:key=>facts.aborted.includes(key),interventions:key=>facts.counts[key]??0};}
   else await commander.wake();
   if(!resuming)s.status='running';save(s);
   const receipt=await runActivityContract(s.profile.contract,{...s.identity.input,run_tag:s.identity.input.run_tag??s.identity.run_id},{cwd:s.profile.cwd,signal:controller.signal,commander,onEvent:observe,...(eligible(s.profile)?{
     ...(resuming?{resume:s.continuation.checkpoint}:{}),
     checkpoint:async checkpoint=>{
      if(s.profile.commander&&(s.commander_pending!==false||s.commander_unknown)){s.continuation=null;save(s);return;}
      if(!s.profile.commander)s.commander_pending=false;
      const a=s.profile.contract.activities[0],binding={run_id:s.identity.run_id,task_id:s.identity.task_id,profile_sha256:s.identity.profile_sha256,runtime_profile_sha256:profileDigest(s.profile),activity:a.key,source_sha256:s.profile.files[a.runtime.entry],checkpoint_sha256:profileDigest(checkpoint)};
      s.continuation={checkpoint,binding,runner_cursor:eventCursor,consumed:false};save(s);
     },
     executeActivity:async(a,input,options)=>{
      const {startSupervisedActivity,waitSupervisedActivity}=await import('../../src/orchestrator/activity-supervisor.js');
      const c=s.continuation;
      if(!c)return callActivityProcess(a,input,options);
      const value=resuming?await waitSupervisedActivity(supervisorDirectory(s),c.binding,{...options,reconnecting:true}):await startSupervisedActivity(supervisorDirectory(s),c.binding,a,input,options,c.checkpoint.deadline);
      c.consumed=true;save(s);return value;
     }}:{}),...(domain?{executeActivity:domain.executeActivity,canFinalize:domain.canFinalize}:{}),
     recoverActivity:async(a,input,options)=>{
      assertProfile(s.profile,s.identity.mode);
      if(domain){if(!domain.recoverActivity)throw Error('workflow_recovery_adapter_required');return domain.recoverActivity(a,input,options);}
      const recovery=s.profile.recoveries?.[a.key],m=s.profile.metadata[a.key];
      if(!recovery&&m.executor_kind!=='agent')throw Error('workflow_recovery_adapter_required');
      if(options.failure?.external_effect==='unknown'&&recovery?.readback_only!==true)throw Error('workflow_recovery_readback_required');
      const skill=recovery?.skill??m.skill;
      const content=fs.readFileSync(path.join(s.profile.cwd,skill.entry),'utf8');
      return callActivityProcess({...a,runtime:{...a.runtime,...(recovery?{entry:recovery.entry,argv:recovery.argv??[]}:{}),executor_kind:'agent'}},{...input,skill:{version:skill.version,sha256:s.profile.files[skill.entry],content}},options);
     },
     checkActivity:async(a,result,options)=>{
      assertProfile(s.profile,s.identity.mode);
      const definitions=options.phase==='start'?s.profile.preconditions:s.profile.validators;
      if(!definitions?.[a.key])return {verdict:'pass',unchecked:true};
      const projected=result?{...options.receipt,outputs:{...options.receipt.outputs,...result.outputs}}:options.receipt;
      return validateActivity(s.profile,a,result,{...options,receipt:projected,signal:a.runtime.phase==='finalize'?options.signal:(options.signal??controller.signal),...(domain?{evaluateScope:domain.checkActivity(a,result,options)}:{})});
     },
     prepareInput:async(a,value)=>{assertProfile(s.profile,s.identity.mode);if(domain?.prepareInput)value=await domain.prepareInput(a,value);const m=s.profile.metadata[a.key];const recording_contract={schema_version:'activity-observations/v1',questions:['A1','A2','A3','A4','A5','A6','B1','C1','C2','C3'],steps_fields:['action','evidence','on_failure','executor','side_effect'],instructions:'在outputs.observations按题记录实际观察及evidence；未知明确未知，不得复制声明冒充事实。steps仅记录真正执行步骤；验收与样本确认由独立判定。'};
      if(m.executor_kind!=='agent')return {...value,recording_contract};
      const content=fs.readFileSync(path.join(s.profile.cwd,m.skill.entry),'utf8');
      return {...value,recording_contract,skill:{version:m.skill.version,sha256:s.profile.files[m.skill.entry],content}};}});
   s.status='validating';s.receipt=receipt;s.execution_unknown=receipt.execution_unknown===true;save(s);
   assertProfile(s.profile,s.identity.mode);
   const validation=await validateWorkflow(s.profile,receipt,{signal:controller.signal,cancelled:controller.signal.aborted,skipActivities:true,...(domain?{evaluateScope:domain.evaluateScope}:{})});
   await closeDomain();
   s.validation=validation;
   await recorder.recordValidation(validation);await recorder.finalize(receipt,validation);
   // 本地终态与中央ACK分开；断网只补记录，绝不重跑业务。
   const finalized=s.profile.contract.activities.filter(a=>a.runtime.phase==='finalize').every(a=>receipt.activities.some(r=>r.key===a.key&&r.status==='completed'));
   s.pending_terminal_status=receipt.execution_unknown?'unknown':receipt.status==='needs_review'?'needs_review':controller.signal.aborted?(finalized&&validation.cleanup?.verdict==='pass'?'cancelled':'unknown'):receipt.status!=='completed'||validation.workflow.verdict==='fail'||Object.values(validation.activities).some(v=>v.verdict==='fail')?'failed':validation.workflow.verdict!=='pass'?'unverified':s.identity.mode==='formal'&&Object.values(validation.activities).some(v=>v.verdict!=='pass')?'unverified':'completed';
   if(['failed','needs_review'].includes(s.pending_terminal_status)){
    s.sample_candidates=receipt.activities.filter(a=>!['completed','skipped'].includes(a.status)).map(a=>({activity:a.key,run_id:s.identity.run_id,status:a.status,validator_verdict:a.validator_verdict,confirmed:false}));
    if(!s.sample_candidates.length)s.sample_candidates=[{activity:null,run_id:s.identity.run_id,status:s.pending_terminal_status,validator_verdict:validation.workflow,confirmed:false}];
    await observe({event_type:'WF_OWNER_REVIEW_REQUIRED',status:s.pending_terminal_status,sample_candidates:s.sample_candidates},receipt);
   }
   s.status='validating';save(s);
  }catch(error){ s.status='unknown';s.reason=/^workflow_(?:domain_[a-z_]+|source_mismatch|profile_invalid)$/.test(error.message??'')?error.message:'workflow_execution_unconfirmed';save(s); }
  finally{try{await closeDomain();}catch{s.status='unknown';s.reason='workflow_domain_close_unconfirmed';delete s.pending_terminal_status;}clearTimeout(domainTimer);try{await commander?.sleep();s.commander_status=commander?.status??'unavailable';s.writeback=await recorder.flush();s.status=s.pending_terminal_status??s.status;delete s.pending_terminal_status;save(s);}catch{s.status='unknown';s.reason='workflow_recording_unconfirmed';save(s);}active.delete(s.identity.run_id);if(!ACTIVE.has(s.status)&&s.writeback?.pending===0&&s.writeback?.blocked===0)recorders.delete(s.identity.run_id);}
 }
 const flushSaved=()=>{const job=flushQueue.then(async()=>{for(const name of fs.readdirSync(stateRoot).filter(n=>n.endsWith('.json'))){
   const s=read(name.slice(0,-5));if(!s)continue;
   if(!ACTIVE.has(s.status)&&s.writeback?.pending===0&&s.writeback?.blocked===0){recorders.delete(s.identity.run_id);continue;}
   try{const r=await makeRecorder(s);const result=await r.flush();const current=read(s.identity.run_id);current.writeback=result;save(current);}catch{/* 保留journal供下次补发，不重启业务。 */}
  }});flushQueue=job.catch(()=>{});return job;};
 for(const s of recoverable){
  const controller=new AbortController();active.set(s.identity.run_id,controller);
  void Promise.resolve().then(async()=>execute(s,await makeRecorder(s),controller,true)).finally(()=>{const current=read(s.identity.run_id);if(current&&!ACTIVE.has(current.status))fs.rmSync(path.join(stateRoot,'execution.lock'),{recursive:true});}).catch(()=>{});
 }
 const retryTimer=setInterval(()=>{void flushSaved();},15000);retryTimer.unref();
 return {
  close:()=>clearInterval(retryTimer),
  flushPending:flushSaved,
  capabilities:()=>({protocol:'common-workflow-runner/v1',profiles:Object.fromEntries(Object.entries(profiles).map(([id,p])=>[id,profileDigest(p)]))}),
  start:async body=>{
   assertIdentity(body);
   if(Object.keys(body).some(k=>!['run_id','task_id','profile','profile_sha256','input','mode','run_binding','request_nonce'].includes(k))||!['exploration','formal'].includes(body.mode)||!body.input||Array.isArray(body.input))throw Error('workflow_request_invalid');
   const {request_nonce:_request_nonce,...identity}=body;
   const prior=read(body.run_id);
   if(prior){if(prior.cancel_tombstone&&prior.identity.task_id===body.task_id)return project(prior);if(profileDigest(prior.identity)!==profileDigest(identity))throw Error('workflow_identity_conflict');return project(prior);}
   const waiting=()=>({run_id:body.run_id,task_id:body.task_id,machine_id:machineId,profile_sha256:body.profile_sha256,mode:body.mode,status:'waiting_resources',execution_state:'not_started'});
   try{assertCanLaunch();await assertLocalResources();assertCanLaunch();}catch{return waiting();}
   // 资源探测 await 后再次判重；保守全局串行，未知执行也占槽。
   const raced=read(body.run_id);if(raced){if(raced.cancel_tombstone&&raced.identity.task_id===body.task_id)return project(raced);if(profileDigest(raced.identity)!==profileDigest(identity))throw Error('workflow_identity_conflict');return project(raced);}
   const pending=fs.readdirSync(stateRoot).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(path.join(stateRoot,n),'utf8'))).some(s=>ACTIVE.has(s.status));
   if(pending)return waiting();
   const profile=structuredClone(profiles[body.profile]);assertProfile(profile,body.mode);
   if(profileDigest(profile)!==body.profile_sha256)throw Error('workflow_profile_mismatch');
   if(body.mode==='formal'){
    const b=body.run_binding;
    if(!b||!UUID.test(b.run_binding_id??'')||typeof b.attempt_key!=='string'||!b.attempt_key)throw Error('workflow_formal_identity_required');
    for(const [key,m]of Object.entries(profile.metadata)){const a=b.activities?.[key],i=m.identity;
     if(!a||a.activity_id!==m.activity_id||a.reference_id!==i.reference_id||a.activity_definition_version_id!==i.activity_definition_version_id||b.workflow_id!==i.workflow_id||b.workflow_definition_version_id!==i.workflow_definition_version_id)throw Error('workflow_binding_mismatch');
     m.identity={...i,run_binding_id:b.run_binding_id,attempt_key:b.attempt_key,enabler_call_id:null};
    }
   }else if(body.run_binding!==undefined)throw Error('workflow_binding_invalid');
   for(const a of profile.contract.activities){const m=profile.metadata[a.key];a.runtime.executor_kind=m.executor_kind;m.implementation={kind:m.executor_kind,entry:a.runtime.entry,sha256:profile.files[a.runtime.entry],...(m.skill?{skill:{...m.skill,sha256:profile.files[m.skill.entry]}}:{})};}
   for(const a of profile.contract.activities){const m=profile.metadata[a.key],r=profile.recoveries?.[a.key];
    if(r||m.executor_kind==='agent'){const skill=r?.skill??m.skill;m.recovery_implementation={kind:'agent',entry:r?.entry??a.runtime.entry,sha256:profile.files[r?.entry??a.runtime.entry],skill:{...skill,sha256:profile.files[skill.entry]}};}
   }
   const {parseActivityContract}=await import('../../src/orchestrator/activity-contract.js');parseActivityContract(profile.contract);
   // import 之后再查闸门，原子mkdir防其它worker进程同时启动。
   try{assertCanLaunch();}catch{return waiting();}
   const lock=path.join(stateRoot,'execution.lock');try{fs.mkdirSync(lock,{mode:0o700});}catch{
    const accepted=read(body.run_id);if(accepted){if(accepted.cancel_tombstone&&accepted.identity.task_id===body.task_id)return project(accepted);if(profileDigest(accepted.identity)!==profileDigest(identity))throw Error('workflow_identity_conflict');return project(accepted);}
    return waiting();
   }
   const s={identity,profile,status:'starting',machine_id:machineId,...(profile.domain_adapter?{domain_started_at_ms:Date.now()}: {})};let recorder;
   const underLock=read(body.run_id);if(underLock){fs.rmdirSync(lock);if(underLock.cancel_tombstone&&underLock.identity.task_id===body.task_id)return project(underLock);if(profileDigest(underLock.identity)!==profileDigest(identity))throw Error('workflow_identity_conflict');return project(underLock);}
   try{persist(ownerFile,{run_id:s.identity.run_id,pid:process.pid,birth:processBirth(process.pid)});save(s);recorder=await makeRecorder(s);}
   catch(error){s.status='unknown';s.reason='workflow_recording_unconfirmed';save(s);throw error;}
   const controller=new AbortController();active.set(body.run_id,controller);
   if(read(body.run_id)?.cancel_requested){s.cancel_requested=true;controller.abort();}
   void execute(s,recorder,controller).finally(()=>{const current=read(body.run_id);if(current&&!ACTIVE.has(current.status))fs.rmSync(lock,{recursive:true});}).catch(()=>{});
   return project(s);
  },
  inspect:async body=>project(existing(body)),
  cancel:async body=>{assertIdentity(body);let s=read(body.run_id);
   if(!s){s={identity:{run_id:body.run_id,task_id:body.task_id},status:'cancelled_before_start',cancel_tombstone:true,execution_state:'not_started',machine_id:machineId,writeback:{pending:0,blocked:0,total:0,acked:0,manifest_sha256:profileDigest([])}};save(s);}
   if(s.identity.task_id!==body.task_id)throw Error('workflow_identity_not_found');
   s.cancel_requested=true;save(s);active.get(body.run_id)?.abort();
   if(s.continuation){try{const manifest=protectedRead(path.join(supervisorDirectory(s),'manifest.json'),3);if(profileDigest(manifest.binding)===profileDigest(s.continuation.binding))persist(path.join(supervisorDirectory(s),'cancel.json'),{nonce:manifest.nonce});}catch{/* 无可靠监督身份时仍保留 unknown。 */}}
   return project(s);},
  flush:async body=>{const s=existing(body);const r=await makeRecorder(s);const result=await r.flush();const current=existing(body);current.writeback=result;save(current);return project(current);},
  maintenance:async()=>({pending:fs.readdirSync(stateRoot).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(path.join(stateRoot,n),'utf8'))).filter(s=>ACTIVE.has(s.status)).length}),
 };
}
module.exports={createWorkflowRunner,profileDigest};
