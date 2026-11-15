import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
import {digest} from '../../src/orchestrator/commander-decision.js';
import {durableWrite} from '../../src/orchestrator/activity-supervisor.js';
import processState from '../../src/orchestrator/activity-supervisor-state.cjs';
export const HEARTBEAT_TIMEOUT_MS=5000;
export const STARTUP_TIMEOUT_MS=10000;
export function startHostHeartbeat(identity){
 const raw=process.env.COMMANDER_HOST_HEARTBEAT;if(!raw)return ()=>{};
 const config=JSON.parse(raw),birth=processState.processBirth(process.pid);
 if(typeof config.file!=='string'||!config.file.startsWith('/')||typeof config.nonce!=='string'||!birth)throw Error('commander_heartbeat_invalid');
 let sequence=0;
 const publish=()=>durableWrite(config.file,{protocol:'commander-host-heartbeat/v1',identity,pid:process.pid,birth,nonce:config.nonce,sequence:++sequence});
 publish();const timer=setInterval(()=>{try{publish();}catch{console.error('commander_heartbeat_unavailable');process.exit(1);}},500);timer.unref();return ()=>clearInterval(timer);
}
export function observeHeartbeat(file,child,identity,observation,now=performance.now()){
 if(!observation||observation.nonce!==child.nonce)observation={nonce:child.nonce,sequence:0,changedAt:now,seen:false};
 try{
  const value=JSON.parse(fs.readFileSync(file,'utf8'));
  if(value.protocol==='commander-host-heartbeat/v1'&&value.pid===child.pid&&value.birth===child.birth&&value.nonce===child.nonce&&digest(value.identity)===digest(identity)&&Number.isSafeInteger(value.sequence)&&value.sequence>observation.sequence){observation={...observation,sequence:value.sequence,changedAt:now,seen:true};}
 }catch{}
 return {...observation,stale:now-observation.changedAt>=(observation.seen?HEARTBEAT_TIMEOUT_MS:STARTUP_TIMEOUT_MS)};
}
/** 只终止已确认的宿主；独立Activity继续由原动作读回协议约束。 */
export async function stopOwnedHost(child){
 if(!child||!processState.sameProcess(child.pid,child.birth))return;
 try{process.kill(child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
 const end=performance.now()+5000;
 while(processState.sameProcess(child.pid,child.birth)){
  if(performance.now()>=end)throw Error('commander_host_stop_unconfirmed');
  await new Promise(resolve=>setTimeout(resolve,40));
 }
}
