import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
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

/** 与现役 Gateway agent 协议一致；CLI 沿用现场已有登录，不读取或推断凭据。 */
export function createOpenClawCommanderTransport({profile,cwd,files={},execute=promisify(execFile)}={}){
 let pending=null;
 const transport=async request=>{
  if(pending)throw Error('commander_previous_turn_unknown');
  if(!profile?.skill?.entry||!profile.skill.version||!path.isAbsolute(cwd??'')||typeof request.run_id!=='string'||!request.run_id)throw Error('commander_profile_unconfigured');
  const entry=profile.skill.entry,root=fs.realpathSync(cwd);
  if(path.isAbsolute(entry)||entry.split('/').includes('..'))throw Error('commander_entry_invalid');
  const full=fs.realpathSync(path.join(root,entry));
  if(!full.startsWith(root+path.sep))throw Error('commander_entry_invalid');
  const content=fs.readFileSync(full,'utf8');
  if(createHash('sha256').update(content).digest('hex')!==files[entry])throw Error('commander_source_mismatch');
  const seconds=profile.timeout_s??60;
  if(!Number.isSafeInteger(seconds)||seconds<1||seconds>300)throw Error('commander_profile_invalid');
  const requestId=randomUUID(),session=createHash('sha256').update(request.run_id).digest('hex');
  const params={agentId:'work-commander',sessionKey:`agent:work-commander:runner:${session}`,thinking:'low',timeout:seconds,modelRun:true,idempotencyKey:requestId,
   message:'你是公共Runner的观察与纠偏Commander。只分析提供的证据，不调用工具，不执行任何外部动作，不判断状态、顺序或通过与否。只输出JSON action=answer|steer|abort|none；answer和steer带text，abort带reason。\n'
    +`固定Commander Skill ${profile.skill.version}，sha256=${files[entry]}：\n${content}\n运行上下文：\n${JSON.stringify(request)}`};
  const turn={requestId,run_id:request.run_id};pending=turn;
  let output;
  try{output=await execute('openclaw',['gateway','call','agent','--expect-final','--json','--timeout',String(seconds*1000),'--params',JSON.stringify(params)],{timeout:seconds*1000,maxBuffer:1024*1024});}
  catch{throw Error('commander_gateway_unavailable');}
  let body;try{body=JSON.parse(output.stdout);}catch{throw Error('commander_gateway_reply_invalid');}
  if(!['ok','completed','success'].includes(body?.status)||body.error||body.ok===false)throw Error('commander_gateway_final_required');
  if(body.runId!==requestId)throw Error('commander_gateway_identity_invalid');
  // 只有对应终态可证明本次Commander已返回；未知时不派第二个并发回合。
  if(pending===turn)pending=null;
  const payloads=body.result?.payloads??body.payloads;
  if(!Array.isArray(payloads))throw Error('commander_gateway_reply_invalid');
  let action;try{action=JSON.parse(payloads.map(p=>p.text??'').join('\n').trim());}catch{throw Error('commander_gateway_reply_invalid');}
  if(!action||typeof action!=='object'||Array.isArray(action))throw Error('commander_gateway_reply_invalid');
  return action;
 };
 // 连接错误不意味着远端停止：只查询原requestId，不再次调用agent。
 transport.reconcile=async({run_id}={})=>{
  if(!pending)return {execution_stopped:true};
  if(pending.run_id!==run_id)return {execution_stopped:false};
  const prior=pending;
  let body;
  try{
   const result=await execute('openclaw',['gateway','call','agent.wait','--json','--timeout','5000','--params',JSON.stringify({runId:prior.requestId,timeoutMs:1000})],{timeout:5000,maxBuffer:1024*1024});
   body=JSON.parse(result.stdout);
  }catch{return {execution_stopped:false};}
  const terminal=['ok','error'].includes(body?.status)&&Number.isFinite(body.endedAt)&&body.endedAt>0
   &&body.pendingError!==true&&body.yielded!==true&&(!body.runId||body.runId===prior.requestId);
  if(!terminal||pending!==prior)return {execution_stopped:false};
  pending=null;
  return {execution_stopped:true};
 };
 return transport;
}
