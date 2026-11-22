import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {startSupervisedActivity,waitSupervisedActivity,inspectSupervisor,durableWrite} from '../../src/orchestrator/activity-supervisor.js';
import {verifySkillReadback,verifySkillFailure,sameIdentity} from './skill-protocol.mjs';
import {parseActivityResult} from '../../src/orchestrator/activity-contract.js';
import {sessionGroup,sessionThreadFile} from './session-group.mjs';
import {digest} from '../../src/orchestrator/commander-decision.js';
import {checkerCriteria,verifyCheckerResult} from './checker-agent-protocol.mjs';
import {checkerEvidenceReceipts} from './checker-evidence.mjs';
import {hostToolsAreQuiescent,hostToolsDidNotDispatch} from './skill-tools-mcp.mjs';
import {archiveActivityHandoff} from './activity-handoff.mjs';
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readOnlyEffects=activity=>activity.runtime?.checker_repair?.effect_scope==='read_only';
const mediatedEffects=activity=>activity.runtime?.checker_repair?.effect_scope==='host_tools';
const reasonCode=error=>/^[a-zA-Z0-9][a-zA-Z0-9_.:/@+-]{0,255}$/.test(error.code??error.message)?error.code??error.message:'skill_observation_failed';
export async function createRuntime({profile,run,verifySource=async()=>{},ledger}) {
  const config=profile.skill_runtime;
  if(!config||!run||!profile.files||!config.control_dir||path.isAbsolute(config.control_dir)||config.control_dir.split(path.sep).includes('..'))throw Error('skill_profile_invalid');
  const root=path.resolve(profile.cwd,config.control_dir,run.run_id);fs.mkdirSync(root,{recursive:true,mode:0o700});
  const verifiedFeedback=new Map(), admittedChecks=new Map();
  const checkKey=(activity,input,phase)=>typeof input.action_id==='string'&&input.action_id?phase+':'+activity.key+':'+input.action_id:null;
  const checkBinding=(activity,input)=>digest({contract:activityContract(activity),input,spec:specFor(activity),files:profile.files,codex:config.codex});
  function rememberCheck(activity,input,phase,verified,deadline,result){
    const key=checkKey(activity,input,phase);if(!key||specFor(activity).checker.mode!=='agent')return result;
    const files=[verified.evidence_ref,...verified.checks.flatMap(c=>c.evidence.map(e=>e.source))];
    admittedChecks.set(key,{binding:checkBinding(activity,input),deadline,verified:structuredClone(verified),
      sources:Object.fromEntries(files.map(file=>[file,hash(file)])),result,resultHash:result?digest(result):null});return result;
  }
  async function consumeCheck(activity,input,phase,signal,result){
    const key=checkKey(activity,input,phase),cached=key&&admittedChecks.get(key);if(!cached)return null;
    admittedChecks.delete(key);
    await verifyFrozenSources();
    if(signal?.aborted||!Number.isFinite(cached.deadline)||Date.now()>=cached.deadline)throw Error('checker_admission_expired');
    if(cached.binding!==checkBinding(activity,input)||phase==='end'&&(cached.result!==result||cached.resultHash!==digest(result))
      ||Object.entries(cached.sources).some(([file,sha])=>hash(file)!==sha))throw Error('checker_admission_unbound');
    return structuredClone(cached.verified);
  }
  const actionDir=identity=>path.join(root,'actions',identity.action_id);
  function specFor(activity){
    const spec=config.activities?.[activity.key],checker=spec?.checker;
    sessionGroup(spec?.session_group,activity.runtime?.executor_kind??'agent');
    const phasePolicy=checker?.phase_policy;
    if(phasePolicy!==undefined&&(phasePolicy!=='completion_only'||checker.mode!=='agent'))throw Error('checker_profile_invalid');
    if(checker?.mode==='agent'){
      if(!profile.codex_auth||checker.entry!==undefined||checker.start_checks!==undefined||checker.required_checks!==undefined)throw Error('checker_profile_invalid');
      const contract=activityContract(activity);
      if(phasePolicy==='completion_only'){
        if(checkerCriteria(contract,'start',{allowEmptyPhase:true}).length)throw Error('checker_start_requirements_unassigned');
        checkerCriteria(contract,'end');
      }else checkerCriteria(contract,'start');
      if((spec.allow_empty===true)!==(Array.isArray(contract.acceptance.document.failure?.empty_ok)&&contract.acceptance.document.failure.empty_ok.length>0))throw Error('checker_empty_policy_mismatch');
    }else if(!spec||!profile.files[checker?.entry]||!path.isAbsolute(checker?.command??'')
      ||['start_checks','required_checks'].some(k=>!Array.isArray(checker[k])||!checker[k].length||new Set(checker[k]).size!==checker[k].length)
      ||hash(checker.command)!==checker.command_sha256)throw Error('skill_profile_unfrozen');
    if((readOnlyEffects(activity)||mediatedEffects(activity))&&checker.mode!=='agent')throw Error('skill_repair_profile_invalid');
    if(mediatedEffects(activity)&&!config.host_tools)throw Error('skill_repair_profile_invalid');
    if(activity.runtime?.executor_kind==='code'){
      if(!profile.files[activity.runtime.entry])throw Error('skill_profile_unfrozen');
    }else if(!profile.files[spec.skill]||!profile.files[config.tools]||!path.isAbsolute(config.codex?.command??'')
      ||hash(config.codex.command)!==config.codex.command_sha256)throw Error('skill_profile_unfrozen');
    if(activity.runtime?.executor_kind!=='code'&&config.host_tools&&(!profile.codex_auth||!profile.files[config.host_tools.entry]))throw Error('skill_profile_unfrozen');
    return spec;
  }
  async function verifyFrozenSources(){
    await verifySource();
    const cwd=fs.realpathSync(profile.cwd);
    for(const [entry,expected] of Object.entries(profile.files)){
      const file=fs.realpathSync(path.resolve(cwd,entry));
      if(!file.startsWith(cwd+path.sep)||hash(file)!==expected)throw Error('commander_source_drift');
    }
  }
  async function checkerTransport(checker,request,signal){
    const transport={stdout:'',stderr:'',exit_code:null,signal:null,timed_out:false,cancelled:false,spawn_error:null,
      stdout_truncated:false,stderr_truncated:false};
    return new Promise(resolve=>{
      let child,timer,finished=false;
      const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);resolve(transport);};
      const cancel=()=>{transport.cancelled=true;child?.kill('SIGKILL');};
      try{child=spawn(checker.command,[path.resolve(profile.cwd,checker.entry),...(checker.args??[])],{cwd:profile.cwd,env:process.env,stdio:['pipe','pipe','pipe']});}
      catch(error){transport.spawn_error=error.code??'spawn_error';finish();return;}
      signal?.addEventListener('abort',cancel,{once:true});
      timer=setTimeout(()=>{transport.timed_out=true;child.kill('SIGKILL');},Math.min(checker.timeout_ms??120000,120000));
      child.stdout.on('data',data=>{const text=data.toString(),remaining=4*1024*1024-transport.stdout.length;transport.stdout+=text.slice(0,remaining);if(text.length>remaining){transport.stdout_truncated=true;child.kill('SIGKILL');}});
      child.stderr.on('data',data=>{const text=data.toString(),remaining=10000-transport.stderr.length;transport.stderr+=text.slice(0,remaining);if(text.length>remaining)transport.stderr_truncated=true;});
      child.once('error',error=>{transport.spawn_error=error.code??'spawn_error';finish();});
      child.once('close',(code,exitSignal)=>{transport.exit_code=code;transport.signal=exitSignal;finish();});
      child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(request));if(signal?.aborted)cancel();
    });
  }
  async function agentCheckerTransport(activity,checker,request,signal,activityDeadline,evidence){
    const finalizer=activity.runtime?.phase==='finalize',runDeadline=finalizer?run.cleanup_deadline_ms:run.deadline_ms;
    if(!Number.isFinite(runDeadline)||!Number.isInteger(checker.timeout_ms)||checker.timeout_ms<1)throw Error('checker_deadline_invalid');
    const deadline=Math.min(runDeadline,activityDeadline??Date.now()+activity.budget.max_duration_s*1000,Date.now()+checker.timeout_ms),directory=path.join(root,'checker-agents',request.nonce);
    const identity={task_id:run.task_id,run_id:run.run_id,activity_key:activity.key,action_id:request.nonce};
    const checkerActivity={key:activity.key,budget:{max_duration_s:Math.max(0.001,(deadline-Date.now())/1000),heartbeat_s:1},runtime:{protocol:'json-stdio-v1',phase:'source',entry:fileURLToPath(new URL('./skill-worker.mjs',import.meta.url)),argv:[],interactive:false}};
    const transport=await startSupervisedActivity(directory,identity,checkerActivity,{role:'checker',identity,activity_key:activity.key,activity_contract:request.activity_contract,
      cwd:profile.cwd,codex:config.codex,codex_auth:profile.codex_auth,...(ledger?{ledger_directory:ledger.directory,ledger_policy:ledger.policy}:{}),
      thread_file:path.join(directory,'thread.json'),work_dir:directory,context:request.context,
      checker_request:request,checker_evidence:evidence,checker_files:profile.files,deadline_ms:deadline},{cwd:profile.cwd,signal},deadline);
    if(transport.execution_stopped===false||transport.external_effect==='unknown'||transport.exit_signal||transport.reason_code){
      throw new Error('checker_execution_unconfirmed',{cause:transport.reason_code});
    }
    return {...transport,checker_directory:directory};
  }
  async function readback(activity,input,phase,proposal,signal,deadlineMs,archiveRoot){
    const observation=ledger?.beginObservation({kind:'checker',activity_key:activity.key,...(input.action_id?{action_id:input.action_id}:{}),phase});
    try{const value=await performReadback(activity,input,phase,proposal,signal,deadlineMs,archiveRoot);
      if(observation)ledger.endObservation(observation.observation_id,{status:'passed'});return value;
    }catch(error){if(observation)ledger.endObservation(observation.observation_id,{status:'failed',reason_code:reasonCode(error)});throw error;}
  }
  function activityContract(activity){
    const frozen=run.contract.activities;
    if(frozen===undefined)return structuredClone(activity);
    const contract=Array.isArray(frozen)&&frozen.find(candidate=>candidate.key===activity.key);
    if(!contract)throw Error('skill_activity_contract_unbound');
    return structuredClone(contract);
  }
  async function performReadback(activity,input,phase,proposal,signal,deadlineMs,archiveRoot){
    const spec=specFor(activity),checker=spec.checker;
    const criteria=checker.mode==='agent'?checkerCriteria(activityContract(activity),phase):undefined;
    const evidence=archiveRoot&&criteria?{...checker.evidence,roots:[...checker.evidence.roots,archiveRoot],archive_root:archiveRoot}:checker.evidence;
    const verifiedStops=phase==='start'&&activity.runtime?.phase==='finalize'
      ? (ledger?.snapshot().observations??[]).filter(item=>item.kind==='execution_stop_verified'&&item.status==='completed')
        .map(({activity_key,action_id,attempt})=>({activity_key,action_id,attempt,execution_stopped:true}))
      : [];
    const request={task_id:run.task_id,run_id:run.run_id,run_tag:run.input.run_tag,workflow:spec.workflow??run.contract.workflow,
      activity:spec.activity??activity.key,activity_contract:activityContract(activity),attempt:activity.runtime?.executor_kind==='code'?1:(input.execution_attempt??1),nonce:randomUUID(),phase,
      checks:criteria?criteria.map(c=>c.id):phase==='start'?checker.start_checks:checker.required_checks,...(criteria?{criteria,evidence_access:{roots:evidence.roots,provider_available:Boolean(evidence.provider)}}:{}),proposal,context:{...run.input,...input},...(verifiedStops.length?{verified_execution_stops:verifiedStops}:{})};
    fs.mkdirSync(path.join(root,'checks'),{recursive:true,mode:0o700});
    const evidenceFile=path.join(root,'checks',request.nonce+'.json');
    durableWrite(evidenceFile,{request,status:'pending'});
    try {await verifyFrozenSources();}
    catch(error){durableWrite(evidenceFile,{request,status:'source_rejected',reason:error.message});throw error;}
    const transport=checker.mode==='agent'?await agentCheckerTransport(activity,checker,request,signal,deadlineMs,evidence):await checkerTransport(checker,request,signal);
    const transportReason=transport.spawn_error?'skill_checker_spawn_failed':transport.timed_out?'skill_checker_timeout'
      :transport.cancelled?'skill_checker_cancelled':transport.stdout_truncated?'skill_checker_output_limit'
        :transport.exit_code!==0?'skill_checker_failed':null;
    if(transportReason){durableWrite(evidenceFile,{request,transport,status:'transport_error',reason:transportReason});throw Error(transportReason);}
    let observed;
    try {observed=JSON.parse(transport.stdout);if(checker.mode==='agent')observed=observed.proposal;}
    catch{durableWrite(evidenceFile,{request,transport,status:'parse_error',reason:'skill_checker_invalid_json'});throw Error('skill_checker_invalid_json');}
    // 验证前保留原始检查结果，来源漂移也不得删除已发生副作用的证据。
    durableWrite(evidenceFile,{request,observed,transport,status:'observed'});
    let verified;
    try {await verifyFrozenSources();
      if(checker.mode==='agent'){
        const binding=JSON.parse(fs.readFileSync(path.join(transport.checker_directory,'checker-evidence-binding.json')));
        verified=verifyCheckerResult(observed,request,checkerEvidenceReceipts(binding),{allowEmpty:spec.allow_empty===true});
        durableWrite(evidenceFile,{request,observed,transport,verified,status:'verified'});return {...verified,evidence_ref:evidenceFile};
      }
      if(phase==='end'&&observed.outcome==='failed'){
        const failure=verifySkillFailure(observed,request);
        throw Object.assign(Error('skill_check_failed'),{checkerFailure:failure,evidenceFile});
      }
      verified=verifySkillReadback(observed,request,{allowEmpty:phase==='end'&&spec.allow_empty===true});}
    catch(error){durableWrite(evidenceFile,{request,observed,transport,status:'rejected',reason:error.message});throw error;}
    durableWrite(evidenceFile,{request,observed,transport,verified,status:'verified'});
    return verified;
  }
  function codeResult(input,transport){
    let value;
    try{value=parseActivityResult(JSON.parse(transport.stdout),input);}
    catch{return {schema_version:1,run_tag:input.run_tag,...(input.line_key===undefined?{}:{line_key:input.line_key}),
      status:'needs_review',failure_class:'needs_human',outputs:{},metrics:{},evidence:[],execution_stopped:false,
      external_effect:'unknown',reason_code:transport.reason_code??'code_result_unconfirmed'};}
    const unknown=transport.external_effect==='unknown'||value.external_effect==='unknown';
    const result={...value,execution_stopped:value.execution_stopped===true&&transport.execution_stopped!==false&&!unknown,
      ...(unknown?{external_effect:'unknown'}:{})};
    if(transport.reason_code||transport.exit_code!==0)return {...result,
      ...(['failed','needs_review'].includes(value.status)?{}:{status:'needs_review',failure_class:'needs_human'}),
      reason_code:transport.reason_code??'code_worker_failed'};
    return result;
  }
  async function verifiedResult(activity,input,transport,signal,deadlineMs,identity){
    if(activity.runtime?.executor_kind==='code')return codeResult(input,transport);
    if(transport.execution_stopped===false||transport.external_effect==='unknown')return {
      schema_version:1,run_tag:input.run_tag,...(input.line_key===undefined?{}:{line_key:input.line_key}),
      status:'needs_review',failure_class:'needs_human',outputs:{},metrics:{},evidence:[],execution_stopped:transport.execution_stopped===true,
      external_effect:'unknown',reason_code:'skill_worker_unconfirmed'};
    if(transport.reason_code||transport.exit_code!==0){
      let failure;try{const value=JSON.parse(transport.stdout);if(value.protocol==='skill-worker-failure/v1'&&value.execution_stopped===true&&value.dispatch_status==='not_started'&&/^usage_(?:(?:token|cost)_budget_(?:exceeded|unknown)|ledger_busy)$/.test(value.reason_code))failure=value;}catch{}
      return {schema_version:1,run_tag:input.run_tag,...(input.line_key===undefined?{}:{line_key:input.line_key}),status:'needs_review',failure_class:'needs_human',outputs:{},metrics:{},evidence:[],execution_stopped:failure?true:transport.execution_stopped===true,reason_code:failure?.reason_code??transport.reason_code??'skill_worker_failed'};
    }
    let {proposal,thread_id}=JSON.parse(transport.stdout);
    let archiveRoot;
    const delivery=activityContract(activity).acceptance?.document?.delivery;
    if(delivery!==undefined){
      const directory=actionDir(identity);
      try{
        await verifyFrozenSources();
        const manifest=archiveActivityHandoff({delivery,identity,proposal,cwd:profile.cwd,directory,
          config:specFor(activity).checker.evidence,deadlineMs,
          denied:[profile.codex_auth?.home,path.join(os.homedir(),'.credentials')].filter(Boolean)});
        const cwd=fs.realpathSync(profile.cwd);
        const parent=path.relative(cwd,path.join(fs.realpathSync(directory),'handoff'));
        if(!parent||parent.split(path.sep).includes('..'))throw Error('delivery_archive_outside_workspace');
        archiveRoot=path.join(parent,'files');
        const delivered=Object.fromEntries(Object.entries(manifest.evidence).map(([scope,group])=>[scope,
          Object.fromEntries(Object.entries(group).map(([role,item])=>[role,{...item,archive_path:path.join(parent,item.file)}]))]));
        proposal={...proposal,delivery_sha256:digest(manifest),delivery_evidence:delivered};
      }catch(error){
        const evidence=path.join(directory,'handoff-rejected.json');
        durableWrite(evidence,{message:error.message,proposal_sha256:digest(proposal),identity});
        return {schema_version:1,run_tag:input.run_tag,...(input.line_key===undefined?{}:{line_key:input.line_key}),
          status:'needs_review',failure_class:'needs_human',outputs:{},metrics:{},evidence:[evidence],
          execution_stopped:true,reason_code:'skill_handoff_incomplete'};
      }
    }
    try{
      let verified;
      try {
        verified=await readback(activity,input,'end',proposal,signal,deadlineMs,archiveRoot);
      } catch(error) {
        // Recheck the original proposal once after a citation error or Checker timeout.
        // The retry is read-only and keeps the Activity deadline.
        const mayRecheck=error.message==='checker_evidence_unbound'||
          (error.message==='checker_execution_unconfirmed'&&error.cause==='activity_timeout');
        if(specFor(activity).checker.mode!=='agent'||!mayRecheck||
          signal?.aborted||Date.now()>=deadlineMs)throw error;
        verified=await readback(activity,input,'end',proposal,signal,deadlineMs,archiveRoot);
      }
      if(verified.outcome==='failed'||verified.outcome==='unknown'){
        const retryable=verified.outcome==='failed'&&
          (readOnlyEffects(activity)||(mediatedEffects(activity)&&hostToolsDidNotDispatch(actionDir(identity),identity)))&&
          verified.checks.every(check=>check.status!=='unknown')&&typeof thread_id==='string'&&Boolean(thread_id.trim());
        const feedback={protocol:'checker-feedback/v1',activity_key:activity.key,attempt:input.execution_attempt??1,outcome:verified.outcome,
          failed_checks:verified.checks.filter(c=>c.status!=='passed').map(({id,status,expected,actual,reason,evidence})=>({id,status,expected,actual,reason,evidence})),
          evidence_ref:verified.evidence_ref,previous_proposal:proposal,thread_id,retryable,
          ...(retryable?{external_effect:'none'}:{retry_reason:'trusted_execution_effects_unavailable'})};
        verifiedFeedback.set(feedback.evidence_ref,structuredClone(feedback));
        return rememberCheck(activity,input,'end',verified,deadlineMs,{
        schema_version:1,run_tag:input.run_tag,...(input.line_key===undefined?{}:{line_key:input.line_key}),status:'needs_review',failure_class:'needs_human',outputs:{},metrics:{},
        evidence:[verified.evidence_ref],execution_stopped:true,reason_code:verified.outcome==='unknown'?'checker_evidence_unknown':'skill_check_failed',checker_result:verified,checker_feedback:feedback});
      }
      return rememberCheck(activity,input,'end',verified,deadlineMs,{schema_version:1,run_tag:input.run_tag,...(input.line_key===undefined?{}:{line_key:input.line_key}),status:verified.outcome==='empty'?'empty':'completed',
        outputs:verified.output,metrics:{},evidence:verified.checks.flatMap(c=>c.evidence.map(e=>e.source)),execution_stopped:true});
    }catch(error){
      const failure=error.checkerFailure;
      const feedback=failure&&typeof thread_id==='string'&&thread_id.trim()?{
        protocol:'checker-feedback/v1',activity_key:activity.key,attempt:input.execution_attempt??1,
        failed_checks:failure.checks.filter(c=>c.status==='failed').map(({id,expected,actual,reason,evidence})=>({id,expected,actual,reason,evidence})),
        evidence_ref:error.evidenceFile,previous_proposal:proposal,thread_id,
        retryable:failure.retryable===true&&['none','known'].includes(failure.external_effect)&&transport.execution_stopped!==false&&transport.external_effect!=='unknown',
        external_effect:transport.external_effect==='unknown'?'unknown':failure.external_effect}:undefined;
      if(feedback)verifiedFeedback.set(feedback.evidence_ref,structuredClone(feedback));
      return {schema_version:1,run_tag:input.run_tag,...(input.line_key===undefined?{}:{line_key:input.line_key}),status:'needs_review',failure_class:'needs_human',outputs:{},metrics:{},
        evidence:feedback?[feedback.evidence_ref]:[],execution_stopped:true,reason_code:feedback?'skill_check_failed':'skill_readback_unconfirmed',
        ...(feedback?{checker_feedback:feedback,...(feedback.external_effect==='unknown'?{external_effect:'unknown'}:{})}:{})};
    }
  }
  function settleAttempt(attempt,result,transport,directory){
    // 外部执行未知或旧监督协议缺起止时间时保留prepared；读回时间不充当执行结束。
    if(!attempt||result.execution_stopped!==true||result.external_effect==='unknown'||!Number.isSafeInteger(transport.started_at_ms)||!Number.isSafeInteger(transport.ended_at_ms)||transport.ended_at_ms<transport.started_at_ms)return;
    ledger.finishAttempt(attempt.attempt_id,{status:result.status==='empty'?'completed':result.status,ended_at_ms:transport.ended_at_ms,evidence_ref:path.join(directory,'result.json')});
  }
  return {
    async checkActivity(activity,result,{phase,input,signal,remaining_ms}){
      if(input.recovery_mode==='readback_only'&&phase==='start')return {verdict:'pass',reason:'recovery_has_no_new_execution'};
      const {checker}=specFor(activity);
      if(phase==='start'&&checker.phase_policy==='completion_only')return {verdict:'pass',reason:'no_activity_start_criteria'};
      if(phase==='end'&&activityContract(activity).acceptance?.document?.delivery!==undefined&&['skill_handoff_incomplete','skill_readback_unconfirmed'].includes(result?.reason_code)){
        parseActivityResult(result,input);
        return {verdict:'unknown',reason:result.reason_code,evidence:result.evidence};
      }
      const cached=phase==='end'&&checker.mode==='agent'&&await consumeCheck(activity,input,phase,signal,result);
      if(cached)return {verdict:['passed','empty'].includes(cached.outcome)?'pass':cached.outcome==='unknown'?'unknown':'fail',reason:'independent_checker_'+cached.outcome,evidence:cached.checks};
      const feedback=result?.checker_feedback;
      if(phase==='end'&&specFor(activity).checker.mode!=='agent'&&feedback&&feedback.activity_key===activity.key&&sameIdentity(verifiedFeedback.get(feedback.evidence_ref),feedback))
        return {verdict:feedback.outcome==='unknown'?'unknown':'fail',reason:feedback.outcome==='unknown'?'checker_evidence_unknown':'skill_check_failed',evidence:feedback.failed_checks};
      const deadline=Number.isFinite(remaining_ms)?Date.now()+Math.max(0,remaining_ms):specFor(activity).checker.mode==='agent'?Math.min(activity.runtime?.phase==='finalize'?run.cleanup_deadline_ms:run.deadline_ms,Date.now()+(activity.budget?.max_duration_s??0)*1000):undefined;
      const verified=await readback(activity,input,phase,result,signal,deadline);
      if(phase==='start')rememberCheck(activity,input,phase,verified,deadline);
      if(specFor(activity).checker.mode==='agent'&&phase==='end'&&result?.schema_version===1)parseActivityResult(result,input);
      if(specFor(activity).checker.mode==='agent')return {verdict:['passed','empty'].includes(verified.outcome)&&(phase==='start'||result?.schema_version===1||sameIdentity(verified.output,result?.outputs))?'pass':verified.outcome==='unknown'?'unknown':'fail',reason:'independent_checker_'+verified.outcome,evidence:verified.checks};
      return {verdict:phase==='start'||sameIdentity(verified.output,result?.outputs)?'pass':'fail',evidence:verified.checks};
    },
    async executeActivity(activity,input,options){
      if(activity.runtime?.executor_kind!=='code')input={...input,execution_attempt:options.identity.attempt??1};
      // 单独再核授权；旧完整Runner的finalize宽松策略不能赋予执行权。
      let spec;
      try{
        spec=specFor(activity);
        if(spec.checker.phase_policy==='completion_only'){
          await verifyFrozenSources();
        }else{
          const start=spec.checker.mode==='agent'&&input.action_id===options.identity.action_id&&await consumeCheck(activity,input,'start',options.signal)
            ||await readback(activity,input,'start',null,options.signal,options.deadlineMs);
          if(start.outcome!=='passed')throw Error('checker_start_'+start.outcome);
        }
      }catch(e){e.executionStopped=true;throw e;}
      const directory=actionDir(options.identity);
      const attempt=ledger?.beginAttempt({activity_key:activity.key,action_id:options.identity.action_id,attempt:options.identity.attempt??1,kind:activity.runtime?.executor_kind??'agent'});
      try{
      if(activity.runtime?.executor_kind==='code'){
        const transport=await startSupervisedActivity(directory,options.identity,activity,input,options,options.deadlineMs);
        const result=await verifiedResult(activity,input,transport,options.signal,options.deadlineMs,options.identity);settleAttempt(attempt,result,transport,directory);
        return result;
      }
      const group=sessionGroup(spec.session_group),threadFile=sessionThreadFile(root,group);
      fs.mkdirSync(path.dirname(threadFile),{recursive:true,mode:0o700});
      const workerActivity={...activity,runtime:{...activity.runtime,entry:fileURLToPath(new URL('./skill-worker.mjs',import.meta.url)),argv:[],interactive:false}};
      const transport=await startSupervisedActivity(directory,options.identity,workerActivity,{identity:options.identity,activity_key:activity.key,activity_contract:activityContract(activity),cwd:profile.cwd,
        codex:config.codex,codex_auth:profile.codex_auth,...(ledger?{ledger_directory:ledger.directory,ledger_policy:ledger.policy}:{}),thread_file:threadFile,...(group===undefined?{}:{session_group:group}),work_dir:directory,skill_text:fs.readFileSync(path.resolve(profile.cwd,spec.skill),'utf8'),
        ...(readOnlyEffects(activity)?{read_only_evidence:spec.checker.evidence,checker_files:profile.files,deadline_ms:options.deadlineMs}
          :config.host_tools?{host_tools:{config:config.host_tools,cwd:profile.cwd,files:profile.files,deadline_ms:options.deadlineMs}}:{}),
        tools_text:fs.readFileSync(path.resolve(profile.cwd,config.tools),'utf8'),context:{...run.input,...input}},options,options.deadlineMs);
      const result=await verifiedResult(activity,input,transport,options.signal,options.deadlineMs,options.identity);settleAttempt(attempt,result,transport,directory);
      return result;
      }catch(error){if(attempt&&error.executionStopped===true)ledger.finishAttempt(attempt.attempt_id,{status:'not_started',reason_code:reasonCode(error)});throw error;}
    },
    async inspectActivityStop(activity,context,{identity,signal,deadlineMs,cleanupDeadlineMs}){
      const checker=config.activities?.[activity.key]?.stop_checker;
      if(checker===undefined)return undefined;
      const directory=actionDir(identity),nonce=randomUUID();
      const request={protocol:'commander-stop-check/v1',identity,nonce,source_deadline_ms:deadlineMs,cleanup_deadline_ms:cleanupDeadlineMs,context};
      const evidenceFile=path.join(directory,'stop-'+nonce+'.json');
      if(activity.runtime.phase!=='source'||identity.activity_key!==activity.key||identity.task_id!==run.task_id||identity.run_id!==run.run_id
        ||!/^[a-f0-9]{64}$/.test(identity.action_id??'')||typeof checker?.entry!=='string'
        ||!Object.hasOwn(profile.files,checker.entry)||path.isAbsolute(checker.entry)||!path.isAbsolute(checker.command??'')
        ||!Number.isSafeInteger(checker.timeout_ms)||checker.timeout_ms<1||checker.timeout_ms>120000)throw Error('skill_stop_checker_invalid');
      const eligible=()=>!signal?.aborted&&Date.now()>=deadlineMs&&Date.now()<cleanupDeadlineMs;
      if(!eligible())throw Error('skill_stop_checker_deadline');
      await verifyFrozenSources();
      if(hash(checker.command)!==checker.command_sha256||inspectSupervisor(directory,identity).deadline!==deadlineMs)throw Error('skill_stop_checker_unbound');
      const worker=await waitSupervisedActivity(directory,identity,{signal,observeOnly:true});
      const hostToolsStopped=()=>activity.runtime.executor_kind==='code'||!config.host_tools||readOnlyEffects(activity)
        ||hostToolsAreQuiescent(directory,identity,deadlineMs);
      if(!Number.isSafeInteger(worker.ended_at_ms)||!hostToolsStopped()||!eligible())throw Error('skill_stop_checker_unconfirmed');
      const transport=await checkerTransport({command:checker.command,entry:checker.entry,timeout_ms:checker.timeout_ms},request,signal);
      if(transport.exit_code!==0||transport.spawn_error||transport.timed_out||transport.cancelled||transport.stdout_truncated||transport.signal)
        throw Error('skill_stop_checker_unconfirmed');
      const observed=JSON.parse(transport.stdout);
      await verifyFrozenSources();
      if(!eligible()||!hostToolsStopped()||hash(checker.command)!==checker.command_sha256||observed?.execution_stopped!==true||observed.nonce!==nonce
        ||!sameIdentity(observed.identity,identity)||!observed.evidence||typeof observed.evidence!=='object'
        ||Array.isArray(observed.evidence)||!Object.keys(observed.evidence).length)throw Error('skill_stop_checker_unconfirmed');
      durableWrite(evidenceFile,{request,observed,supervisor_result:path.join(directory,'result.json')});
      const observation=ledger?.beginObservation({kind:'execution_stop_verified',activity_key:activity.key,
        action_id:identity.action_id,attempt:identity.attempt??1});
      if(observation)ledger.endObservation(observation.observation_id,{status:'completed',evidence_ref:evidenceFile});
      return {identity,execution_stopped:true,evidence_ref:evidenceFile};
    },
    async inspectActivity(activity,input,options){
      if(activity.runtime?.executor_kind!=='code')input={...input,execution_attempt:options.identity.attempt??1};
      const directory=actionDir(options.identity);
      const observation=ledger?.beginObservation({kind:'recovery_readback',activity_key:activity.key,action_id:options.identity.action_id});
      try{specFor(activity);await verifyFrozenSources();inspectSupervisor(directory,options.identity);const transport=await waitSupervisedActivity(directory,options.identity,{signal:options.signal,reconnecting:true});
        const result=await verifiedResult(activity,input,transport,options.signal,options.deadlineMs,options.identity);
        const original=ledger?.snapshot?.().attempts.find(a=>a.action_id===options.identity.action_id&&a.attempt===(options.identity.attempt??1)&&a.status==='prepared');
        settleAttempt(original,result,transport,directory);
        if(observation)ledger.endObservation(observation.observation_id,{status:result.execution_stopped===true?'completed':'unknown',evidence_ref:path.join(directory,'result.json')});
        return {state:'completed',identity:options.identity,execution_stopped:result.execution_stopped===true,result};
      }catch(error){if(observation)ledger.endObservation(observation.observation_id,{status:'unknown',reason_code:reasonCode(error)});return {state:'unknown',identity:options.identity,execution_stopped:false};}
    },
  };
}
