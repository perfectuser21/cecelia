import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {startSupervisedActivity,waitSupervisedActivity,inspectSupervisor,durableWrite} from '../../src/orchestrator/activity-supervisor.js';
import {verifySkillReadback,sameIdentity} from './skill-protocol.mjs';
import {parseActivityResult} from '../../src/orchestrator/activity-contract.js';
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export async function createRuntime({profile,run,verifySource=async()=>{}}) {
  const config=profile.skill_runtime;
  if(!config||!run||!profile.files||!config.control_dir||path.isAbsolute(config.control_dir)||config.control_dir.split(path.sep).includes('..'))throw Error('skill_profile_invalid');
  const root=path.resolve(profile.cwd,config.control_dir,run.run_id);fs.mkdirSync(root,{recursive:true,mode:0o700});
  const actionDir=identity=>path.join(root,'actions',identity.action_id);
  function specFor(activity){
    const spec=config.activities?.[activity.key],checker=spec?.checker;
    if(!spec||!profile.files[checker?.entry]||!path.isAbsolute(checker?.command??'')
      ||['start_checks','required_checks'].some(k=>!Array.isArray(checker[k])||!checker[k].length||new Set(checker[k]).size!==checker[k].length)
      ||hash(checker.command)!==checker.command_sha256)throw Error('skill_profile_unfrozen');
    if(activity.runtime?.executor_kind==='code'){
      if(!profile.files[activity.runtime.entry])throw Error('skill_profile_unfrozen');
    }else if(!profile.files[spec.skill]||!profile.files[config.tools]||!path.isAbsolute(config.codex?.command??'')
      ||hash(config.codex.command)!==config.codex.command_sha256)throw Error('skill_profile_unfrozen');
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
  async function readback(activity,input,phase,proposal,signal){
    const spec=specFor(activity),checker=spec.checker;
    const request={task_id:run.task_id,run_id:run.run_id,run_tag:run.input.run_tag,workflow:spec.workflow??run.contract.workflow,
      activity:spec.activity??activity.key,attempt:1,nonce:randomUUID(),phase,
      checks:phase==='start'?checker.start_checks:checker.required_checks,proposal,context:{...run.input,...input}};
    fs.mkdirSync(path.join(root,'checks'),{recursive:true,mode:0o700});
    const evidenceFile=path.join(root,'checks',request.nonce+'.json');
    durableWrite(evidenceFile,{request,status:'pending'});
    try {await verifyFrozenSources();}
    catch(error){durableWrite(evidenceFile,{request,status:'source_rejected',reason:error.message});throw error;}
    const transport=await checkerTransport(checker,request,signal);
    const transportReason=transport.spawn_error?'skill_checker_spawn_failed':transport.timed_out?'skill_checker_timeout'
      :transport.cancelled?'skill_checker_cancelled':transport.stdout_truncated?'skill_checker_output_limit'
        :transport.exit_code!==0?'skill_checker_failed':null;
    if(transportReason){durableWrite(evidenceFile,{request,transport,status:'transport_error',reason:transportReason});throw Error(transportReason);}
    let observed;
    try {observed=JSON.parse(transport.stdout);}
    catch{durableWrite(evidenceFile,{request,transport,status:'parse_error',reason:'skill_checker_invalid_json'});throw Error('skill_checker_invalid_json');}
    // 验证前保留原始检查结果，来源漂移也不得删除已发生副作用的证据。
    durableWrite(evidenceFile,{request,observed,transport,status:'observed'});
    let verified;
    try {await verifyFrozenSources();verified=verifySkillReadback(observed,request,{allowEmpty:phase==='end'&&spec.allow_empty===true});}
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
  async function verifiedResult(activity,input,transport,signal){
    if(activity.runtime?.executor_kind==='code')return codeResult(input,transport);
    if(transport.reason_code||transport.exit_code!==0){return {schema_version:1,run_tag:input.run_tag,...(input.line_key===undefined?{}:{line_key:input.line_key}),status:'needs_review',failure_class:'needs_human',outputs:{},metrics:{},evidence:[],execution_stopped:transport.execution_stopped===true,reason_code:transport.reason_code??'skill_worker_failed'};}
    const {proposal}=JSON.parse(transport.stdout);
    try{
      const verified=await readback(activity,input,'end',proposal,signal);
      return {schema_version:1,run_tag:input.run_tag,...(input.line_key===undefined?{}:{line_key:input.line_key}),status:verified.outcome==='empty'?'empty':'completed',
        outputs:verified.output,metrics:{},evidence:verified.checks.flatMap(c=>c.evidence.map(e=>e.source)),execution_stopped:true};
    }catch{return {schema_version:1,run_tag:input.run_tag,...(input.line_key===undefined?{}:{line_key:input.line_key}),status:'needs_review',failure_class:'needs_human',outputs:{},metrics:{},evidence:[],execution_stopped:true,reason_code:'skill_readback_unconfirmed'};}
  }
  return {
    async checkActivity(activity,result,{phase,input,signal}){
      if(input.recovery_mode==='readback_only'&&phase==='start')return {verdict:'pass',reason:'recovery_has_no_new_execution'};
      const verified=await readback(activity,input,phase,result,signal);
      return {verdict:phase==='start'||sameIdentity(verified.output,result?.outputs)?'pass':'fail',evidence:verified.checks};
    },
    async executeActivity(activity,input,options){
      // 单独再核授权；旧完整Runner的finalize宽松策略不能赋予执行权。
      try{await readback(activity,input,'start',null,options.signal);}catch(e){e.executionStopped=true;throw e;}
      const spec=specFor(activity),directory=actionDir(options.identity);
      if(activity.runtime?.executor_kind==='code'){
        const transport=await startSupervisedActivity(directory,options.identity,activity,input,options,options.deadlineMs);
        return verifiedResult(activity,input,transport,options.signal);
      }
      const workerActivity={...activity,runtime:{...activity.runtime,entry:fileURLToPath(new URL('./skill-worker.mjs',import.meta.url)),argv:[],interactive:false}};
      const transport=await startSupervisedActivity(directory,options.identity,workerActivity,{identity:options.identity,activity_key:activity.key,cwd:profile.cwd,
        codex:config.codex,thread_file:path.join(root,'thread.json'),work_dir:directory,skill_text:fs.readFileSync(path.resolve(profile.cwd,spec.skill),'utf8'),
        tools_text:fs.readFileSync(path.resolve(profile.cwd,config.tools),'utf8'),context:{...run.input,...input}},options,options.deadlineMs);
      return verifiedResult(activity,input,transport,options.signal);
    },
    async inspectActivity(activity,input,options){
      const directory=actionDir(options.identity);
      try{specFor(activity);await verifyFrozenSources();inspectSupervisor(directory,options.identity);const transport=await waitSupervisedActivity(directory,options.identity,{signal:options.signal,reconnecting:true});
        const result=await verifiedResult(activity,input,transport,options.signal);
        return {state:'completed',identity:options.identity,execution_stopped:result.execution_stopped===true,result};
      }catch{return {state:'unknown',identity:options.identity,execution_stopped:false};}
    },
  };
}
