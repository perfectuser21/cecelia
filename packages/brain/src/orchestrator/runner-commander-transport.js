import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {callActivityProcess} from './activity-process.js';

/** 只调用受保护 profile 指定的固定进程；没有请求提供的命令、地址或凭据。 */
export function createCommanderTransport({profile,cwd,files={}}={}){
 let prior=null;
 const transport=async request=>{
  if(prior?.active)throw Error('commander_previous_turn_unknown');
  if(!profile?.entry||!profile.skill?.entry||!profile.skill?.version||!path.isAbsolute(cwd??''))throw Error('commander_profile_unconfigured');
  const root=fs.realpathSync(cwd);
  const read=entry=>{
   if(typeof entry!=='string'||path.isAbsolute(entry)||entry.split('/').includes('..'))throw Error('commander_entry_invalid');
   const full=fs.realpathSync(path.join(root,entry));
   if(!full.startsWith(root+path.sep))throw Error('commander_entry_invalid');
   const content=fs.readFileSync(full);
   if(createHash('sha256').update(content).digest('hex')!==files[entry])throw Error('commander_source_mismatch');
   return content.toString('utf8');
  };
  read(profile.entry);const content=read(profile.skill.entry);
  const seconds=profile.timeout_s??60;
  if(!Number.isSafeInteger(seconds)||seconds<1||seconds>300||profile.argv!==undefined&&(!Array.isArray(profile.argv)||profile.argv.some(a=>typeof a!=='string')))throw Error('commander_profile_invalid');
  const turn={active:true,stopped:false};prior=turn;
  const result=await callActivityProcess({budget:{max_duration_s:seconds,heartbeat_s:Math.min(5,seconds)},runtime:{entry:profile.entry,argv:profile.argv??[],cleanup_grace_s:1}},
   {...request,skill:{version:profile.skill.version,sha256:files[profile.skill.entry],content}},{cwd});
  const stopped=result.execution_stopped===true||(!result.reason_code&&(Number.isInteger(result.exit_code)||typeof result.exit_signal==='string'));
  turn.active=false;turn.stopped=stopped;
  const terminalError=message=>Object.assign(Error(message),{commanderExecutionStopped:stopped});
  if(result.reason_code||result.exit_code!==0)throw terminalError('commander_transport_failed');
  let value;try{value=JSON.parse(result.stdout);}catch{throw terminalError('commander_reply_invalid');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw terminalError('commander_reply_invalid');
  return value;
 };
 transport.reconcile=async()=>({execution_stopped:prior?.stopped===true});
 return transport;
}

/** 旧Gateway配置保留明确不可用状态；不能创建新会话或证明旧会话停止。 */
export function createOpenClawCommanderTransport(){
 const transport=async()=>{throw Error('commander_openclaw_unavailable');};
 transport.reconcile=async()=>({execution_stopped:false});
 return transport;
}
