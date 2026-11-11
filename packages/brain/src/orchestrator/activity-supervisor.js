import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {callActivityProcess} from './activity-process.js';

export function durableWrite(file,value){
 const temp=file+'.'+randomUUID()+'.tmp',fd=fs.openSync(temp,'wx',0o600);
 try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(temp,file);const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
import state from './activity-supervisor-state.cjs';
const {protectedText,protectedRead,processBirth,sameProcess,digest,validResult}=state;
const read=file=>protectedRead(file,3);
export function inspectSupervisor(directory,binding){
 const manifest=read(path.join(directory,'manifest.json'));
 if(JSON.stringify(manifest.binding)!==JSON.stringify(binding)||manifest.protocol!=='activity-supervisor/v1'||!manifest.nonce)throw Error('activity_supervisor_identity_invalid');
 const resultFile=path.join(directory,'result.json');
 if(fs.existsSync(resultFile)){const result=read(resultFile);if(!validResult(result,manifest))throw Error('activity_supervisor_result_invalid');}
 else if(!sameProcess(manifest.pid,manifest.birth))throw Error('activity_supervisor_missing');
 return manifest;
}
export async function waitSupervisedActivity(directory,binding,{signal,onHeartbeat,onAgentEvent,reconnecting=false}={}){
 const manifest=inspectSupervisor(directory,binding);let cursor=0;
 const cancel=()=>durableWrite(path.join(directory,'cancel.json'),{nonce:manifest.nonce});
 signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
 try{while(true){
  // 已接回的非交互 Activity 不再唤醒 Commander；监督进程的原始 stderr 保留全部证据。
  const eventsFile=path.join(directory,'events.jsonl');
  if(!reconnecting&&fs.existsSync(eventsFile)){
   const lines=protectedText(eventsFile,3).split('\n');
   while(cursor<lines.length-1){const event=JSON.parse(lines[cursor++]);
    if(event.kind==='heartbeat')await onHeartbeat?.(event.value);
    else {const action=await onAgentEvent?.(event.value);if(action?.action==='abort')cancel();}
   }
  }
  const resultFile=path.join(directory,'result.json');
  if(fs.existsSync(resultFile)){const value=read(resultFile);if(!validResult(value,manifest))throw Error('activity_supervisor_result_invalid');return value.transport;}
  if(!sameProcess(manifest.pid,manifest.birth)||Date.now()>manifest.deadline+(manifest.cleanup_grace_s+2)*1000)throw Error('activity_supervisor_unconfirmed');
  await new Promise(resolve=>setTimeout(resolve,25));
 }}catch(error){cancel();throw Object.assign(error,{executionStopped:false});}finally{signal?.removeEventListener('abort',cancel);}
}
export async function startSupervisedActivity(directory,binding,activity,input,options,deadline){
 if(options.signal?.aborted)throw Object.assign(Error('run_cancelled'),{executionStopped:true});
 if(!Number.isFinite(deadline)||deadline<=Date.now())throw Object.assign(Error('activity_deadline_elapsed'),{executionStopped:true});
 fs.mkdirSync(path.dirname(directory),{recursive:true,mode:0o700});
 fs.mkdirSync(directory,{mode:0o700});
 const nonce=randomUUID(),manifest={protocol:'activity-supervisor/v1',binding,nonce,deadline,cleanup_grace_s:activity.runtime.cleanup_grace_s??5,pid:null};
 durableWrite(path.join(directory,'manifest.json'),manifest);
 // 不序列化环境或凭据；子进程沿用既有环境，磁盘仅保存本次输入和固定执行描述。
 durableWrite(path.join(directory,'request.json'),{activity,input,cwd:options.cwd});
 const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--supervise',directory],{cwd:options.cwd,detached:true,stdio:'ignore'});
 child.unref();
 // PID 落盘前监督进程不会启动 Activity；无有效身份时新 Worker 必须拒绝续接。
 manifest.pid=child.pid;manifest.birth=processBirth(child.pid);durableWrite(path.join(directory,'manifest.json'),manifest);
 return waitSupervisedActivity(directory,binding,options);
}
async function supervise(directory){
 let manifest;
 for(let i=0;i<200;i++){manifest=read(path.join(directory,'manifest.json'));if(manifest.pid===process.pid)break;await new Promise(r=>setTimeout(r,10));}
 if(manifest.pid!==process.pid||!sameProcess(process.pid,manifest.birth))return;
 const {activity,input,cwd}=read(path.join(directory,'request.json')),controller=new AbortController();
 const events=fs.openSync(path.join(directory,'events.jsonl'),'a',0o600);
 const append=(kind,value)=>{fs.writeSync(events,JSON.stringify({kind,value})+'\n');fs.fsyncSync(events);};
 const pollCancel=()=>{if(fs.existsSync(path.join(directory,'cancel.json'))){try{if(read(path.join(directory,'cancel.json')).nonce===manifest.nonce)controller.abort();}catch{controller.abort();}}};
 const timer=setInterval(pollCancel,25);pollCancel();
 try{
  if(manifest.deadline<=Date.now()||controller.signal.aborted)return;
  const remaining=(manifest.deadline-Date.now())/1000;
  if(remaining<=0)return;
  const transport=await callActivityProcess({...activity,budget:{...activity.budget,max_duration_s:remaining}},input,{cwd,signal:controller.signal,onHeartbeat:async value=>append('heartbeat',value),onAgentEvent:async value=>{append('agent',value);return {action:'none'};}});
  durableWrite(path.join(directory,'result.json'),{protocol:'activity-supervisor-result/v1',nonce:manifest.nonce,binding:manifest.binding,deadline:manifest.deadline,transport,transport_sha256:digest(transport)});
 }finally{clearInterval(timer);fs.closeSync(events);}
}
if(process.argv[2]==='--supervise'&&process.argv[1]===fileURLToPath(import.meta.url))await supervise(process.argv[3]);
