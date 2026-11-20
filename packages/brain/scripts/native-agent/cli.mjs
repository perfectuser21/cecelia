import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {context,validateInput,profileFor} from './config.mjs';
import {write,loadRun,bind,stateOf,response,digest,common} from './store.mjs';
process.umask(0o077);
let input, launchState='unknown';
try{
 process.stdin.setEncoding('utf8');let body='';for await(const x of process.stdin){body+=x;if(body.length>12*1024*1024)throw Error('native_agent_request_too_large');}input=JSON.parse(body);validateInput(input);input=Object.fromEntries(Object.keys(input).sort().map(k=>[k,input[k]]));
 const ctx=context(process.argv[2],process.argv[3]);const dir=path.join(ctx.config.state_dir,input.run_id);
 let run;
 if(fs.existsSync(dir)){
  run=loadRun(ctx,input.run_id);bind(run.request,input);
  if(input.action==='start'){
   const original={...run.request.input};if(digest(original)!==digest({...input,action:'start'}))throw Error('native_agent_run_binding_conflict');
  }
 }else{
  if(input.action!=='start')throw Error('native_agent_run_not_found');
  launchState='not_started';
  const profile=profileFor(ctx,input);
  launchState='unknown';
  try{fs.mkdirSync(dir,{mode:0o700});}catch(e){if(e.code==='EEXIST')throw Error('native_agent_start_unconfirmed');throw e;}
  const request={input,actual_cli_model:profile.cli_model,frozen:profile.frozen};
  write(path.join(dir,'request.json'),request);write(path.join(dir,'state.json'),{request_digest:digest(request),status:'running',launch_state:'unknown',execution_stopped:false});
  const worker=spawn(process.execPath,[path.join(import.meta.dirname,'worker.mjs'),ctx.file,input.run_id,ctx.bundle],{cwd:'/',env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:profile.p.home,LANG:'C.UTF-8'},detached:true,stdio:'ignore'});worker.on('error',()=>{});worker.unref();
  run={dir,request};
 }
 let state=stateOf(run);
 if(input.action==='cancel'&&state.launch_state==='running'){
  write(path.join(dir,'cancel.json'),{request_digest:digest(run.request)});
  // 不猜停止：仅worker实际读回退出后才可返回execution_stopped。
  for(let n=0;n<60;n++){await new Promise(r=>setTimeout(r,50));state=stateOf(run);if(state.launch_state==='stopped'||state.launch_state==='not_started')break;}
 }
 console.log(JSON.stringify(response(run,state)));
}catch(e){
 const error=typeof e.message==='string'&&/^(?:native_agent_|codex_auth_|activity_state_)/.test(e.message)?e.message:'native_agent_unconfirmed';
 console.log(JSON.stringify({protocol:'native-agent/v1',...(input?common(input):{}),status:launchState==='not_started'?'rejected':'unknown',launch_state:launchState,execution_stopped:launchState==='not_started',error,summary:'未确认原生会话状态'}));process.exitCode=1;
}
