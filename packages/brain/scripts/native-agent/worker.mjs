import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {context,profileFor,authFor} from './config.mjs';
import {loadRun,read,write,protectedText,processBirth,digest} from './store.mjs';
import {stopGroup,groupMembers} from './process.mjs';
process.umask(0o077);
const [, ,configFile,runId,expected]=process.argv;
let run,state;
try{
 const ctx=context(configFile,expected);run=loadRun(ctx,runId);const r=run.request.input;
 const profile=profileFor(ctx,r);if(profile.cli_model!==run.request.actual_cli_model||digest(profile.frozen)!==digest(run.request.frozen))throw Error('native_agent_profile_drift');
 state={request_digest:digest(run.request),status:'running',launch_state:'unknown',execution_stopped:false,worker:{pid:process.pid,birth:processBirth(process.pid)}};
 write(path.join(run.dir,'state.json'),state);
 const output=path.join(run.dir,'final.txt');fs.writeFileSync(output,'',{flag:'wx',mode:0o600});
 if(Date.now()>=r.deadline_ms)throw Error('native_agent_deadline_expired');
 const child=spawn(profile.p.command,[...profile.auth.args,'exec','--skip-git-repo-check','--json','--output-last-message',output,'--model',profile.cli_model,'-c','model_reasoning_effort='+JSON.stringify(r.thinking),'-'],{cwd:profile.p.cwd,env:profile.env,detached:true,stdio:['pipe','pipe','pipe']});
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 let stdout='',stderr='',overflow=false,exitInfo=null,spawnError=false;
 child.stdout.on('data',x=>{if(stdout.length+x.length>8*1024*1024)overflow=true;else stdout+=x;});child.stderr.on('data',x=>{if(stderr.length+x.length>8*1024*1024)overflow=true;else stderr+=x;});
 child.on('error',()=>{spawnError=true;});child.on('close',(code,signal)=>{exitInfo={exit_code:code,signal};});child.stdin.on('error',()=>{});child.stdin.end(profile.stdin);
 if(!Number.isSafeInteger(child.pid))throw Error('native_agent_command_start_failed');
 const birth=processBirth(child.pid);
 state={...state,child:{pid:child.pid,birth},launch_state:'running'};write(path.join(run.dir,'state.json'),state);
 let reason;
 while(!exitInfo&&!spawnError){
  await new Promise(r=>setTimeout(r,50));
  let cancel=false;if(fs.existsSync(path.join(run.dir,'cancel.json'))){const c=read(path.join(run.dir,'cancel.json'));if(c.request_digest!==state.request_digest)throw Error('native_agent_cancel_binding_conflict');cancel=true;}
  if(cancel||Date.now()>=r.deadline_ms||overflow){reason=cancel?'cancelled':overflow?'failed':'timed_out';if(!await stopGroup(state.child,profile.p.terminate_grace_ms))throw Error('native_agent_process_group_unknown');break;}
 }
 for(let n=0;n<80&&!exitInfo&&!spawnError;n++)await new Promise(r=>setTimeout(r,25));
 if(spawnError||!exitInfo)throw Error('native_agent_child_exit_unknown');
 const members=groupMembers(child.pid);if(members===null||members.length)throw Error('native_agent_descendants_unconfirmed');
 authFor(profile.p);
 write(path.join(run.dir,'state.json'),{...state,status:reason||(exitInfo.exit_code===0?'completed':'failed'),launch_state:'stopped',execution_stopped:true,termination_scope:reason?'known_process_group':undefined,result:{...exitInfo,stdout,stderr,final_text:protectedText(output,2),child_exited:true}});
}catch(e){if(run)write(path.join(run.dir,'state.json'),{...(state||{}),request_digest:digest(run.request),status:'unknown',launch_state:'unknown',execution_stopped:false,error:/^(native_agent_|codex_auth_)/.test(e.message)?e.message:'native_agent_worker_unconfirmed'});}
