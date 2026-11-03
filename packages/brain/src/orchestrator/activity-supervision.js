import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {runActivityContract} from './activity-runtime.js';
import {callActivityProcess} from './activity-process.js';
import {createCommanderBridge} from './runner-commander-bridge.js';
import {createOpenClawCommanderTransport} from './runner-commander-transport.js';

const sourceRoot=fileURLToPath(new URL('../../../../',import.meta.url));
const skillEntry='packages/brain/skills/runner-commander/SKILL.md';
export function trustedCommanderTransport(){
 const lock=JSON.parse(fs.readFileSync(path.join(sourceRoot,'.skills-source.json'),'utf8'));
 const state=JSON.parse(fs.readFileSync(path.join(sourceRoot,'.skills-source-state.json'),'utf8'));
 if(lock.repository!=='perfectuser21/zenithjoy-skills'||state.revision!==lock.revision||!state.files?.[skillEntry])throw Error('commander_skill_source_unverified');
 const bytes=fs.readFileSync(path.join(sourceRoot,skillEntry),'utf8');
 if(createHash('sha256').update(bytes).digest('hex')!==state.files[skillEntry])throw Error('commander_skill_source_mismatch');
 const version=bytes.match(/^  version:\s*(\S+)\s*$/m)?.[1];
 if(!version)throw Error('commander_skill_version_required');
 return createOpenClawCommanderTransport({cwd:sourceRoot,profile:{kind:'openclaw',timeout_s:60,skill:{entry:skillEntry,version}},files:{[skillEntry]:state.files[skillEntry]}});
}

/** CLI 与 coding workflow 共用同一 Activity 循环；监督配置来自可信合同与源码固定技能。 */
export async function runActivityContractWithCommander(contract,input,{onEvent=async()=>{},...options}={}){
 const enabled=contract?.commander?.enabled===true;
 let transport=async()=>{throw Error('commander_transport_unconfigured');};
 if(enabled){try{transport=trustedCommanderTransport();}catch(error){transport=async()=>{throw error;};}}
 let cursor=0,current={schema_version:1,workflow:contract?.workflow,run_tag:input?.run_tag,status:'running',activities:[]},woken=false;
 const events=[];
 const emit=async(event,receipt=current)=>{
  current=receipt;const numbered={...event,cursor:++cursor};
  if(numbered.event_type.startsWith('COMMANDER_'))events.push(numbered);
  await onEvent(numbered,{...receipt,commander_status:commander.status,commander_events:[...events]});
 };
 const commander=createCommanderBridge({run_id:input?.run_tag,brief:contract?.brief??{purpose:contract?.workflow},rules:contract?.rules??[],transport,onEvent:emit});
 let result;
 try{
  result=await runActivityContract(contract,input,{...options,...(enabled?{commander}:{}),executeActivity:async(a,value,opts)=>{
   const raw=await (options.executeActivity??callActivityProcess)(a,value,opts);
   if(!enabled||typeof raw?.stdout!=='string'||raw.reason_code||raw.execution_stopped===false)return raw;
   let decoded;try{decoded=JSON.parse(raw.stdout);}catch{return raw;}
   // 只把合同已登记且可安全重复的失败分类为 retry；不接受模型自行扩大重试范围。
   if(decoded.status==='failed'&&decoded.failure_class==='retryable'&&decoded.external_effect!=='unknown'
    &&a.runtime.retry_safe===true&&a.failure.retryable.includes(decoded.reason_code))
     return {...raw,stdout:JSON.stringify({...decoded,executor_status:decoded.status,status:'retry'})};
   return raw;
  },onEvent:async(event,receipt)=>{
   await emit(event,receipt);
   // 持久事件的首条仍为 WF_RUN_STARTED，不让监督事件抢占既有source身份。
   if(event.event_type==='WF_RUN_STARTED'){woken=true;await commander.wake();}
   else if(['ACTIVITY_STARTED','ACTIVITY_FINISHED'].includes(event.event_type))await commander.notify(event.activity,{type:'activity_observation',event}, {executor_kind:'code'});
  }});
  current=result;
 }finally{if(woken)await commander.sleep();}
 return {...result,commander_status:commander.status,commander_events:events};
}
