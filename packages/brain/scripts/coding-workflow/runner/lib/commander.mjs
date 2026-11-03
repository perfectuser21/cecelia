// PR升级是只读观察与待审入口。Commander不再修改规格、代码、预算或验收结论。
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createCommanderBridge} from '../../../../src/orchestrator/runner-commander-bridge.js';
import {trustedCommanderTransport} from '../../../../src/orchestrator/activity-supervision.js';
import {listOwnPrs,ghJson} from './cifix-scan.mjs';
import {notifyBark} from './bark.mjs';
import {prFile,prLabel} from './repos.mjs';
import {syncTaskId,syncTask} from './pr-sync.mjs';
import {gateSpan,postSpans} from './spans.mjs';

const HANDLED=new Set(['judge_contract_gap','judge_ruling_conflict','qa_fix_failed','qa_stalled','qa_cannot_verify','qa_smoke_missing','ci_fix_exhausted']);
const read=(file,fallback)=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}};
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{mode:0o600,flush:true});};
function escalationOf(cfg,pr){
 const qa=read(prFile(cfg,`qa-${pr}.json`),null);if(qa?.escalated)return {kind:'qa',detail:qa.escalated};
 const ci=read(prFile(cfg,`cifix-${pr}.json`),null);return ci?.escalated?{kind:'cifix',detail:ci.escalated}:null;
}

/** 同一升级只观察/提醒一次；原升级和批准状态均不写入。 */
export async function runCommander(ctx,signal){
 const {cfg}=ctx;
 try{
  for(const pr of await listOwnPrs(cfg)??[]){
   if(signal?.aborted)return false;
   const escalation=escalationOf(cfg,pr.number);if(!escalation)continue;
   if((await ghJson(cfg,['pr','view',String(pr.number),'--json','state']))?.state!=='OPEN')continue;
   const fingerprint=createHash('sha256').update(JSON.stringify(escalation)).digest('hex');
   const file=prFile(cfg,`commander-${pr.number}.json`),state={interventions:[],observations:[],...read(file,{})};
   if(state.human?.escalation_fingerprint===fingerprint)continue;
   const observation={at:new Date().toISOString(),escalation,fingerprint,events:[],guidance:[]};
   if(HANDLED.has(escalation.detail.type)){
    let transport;try{transport=trustedCommanderTransport();}catch(error){transport=async()=>{throw error;};}
    const bridge=createCommanderBridge({run_id:`coding-observer:${cfg.repoKey??'cecelia'}:pr${pr.number}:${fingerprint}`,brief:{purpose:'观察PR升级，指出需要补采的证据；保持原规格和待审状态'},rules:['不得改规格或代码','不得重置预算','不得批准QA、免除smoke或合并'],transport,
     onEvent:async event=>{observation.events.push({...event,cursor:observation.events.length+1});write(file,{...state,pending_observation:observation});}});
    try{await bridge.wake();await bridge.notify('review',{type:'error',escalation},{executor_kind:'agent'});observation.guidance=bridge.takeGuidance('review');}
    finally{await bridge.sleep();}
    observation.commander_status=bridge.status;
   }
   state.observations.push(observation);delete state.pending_observation;
   const taskId=await syncTaskId(ctx,pr);
   if(taskId){
    await syncTask(ctx,taskId,pr);
    const span=gateSpan({taskId,key:'commander',startedAt:Date.parse(observation.at),endedAt:Date.now(),ok:false,
     occurrence:`${pr.number}:observe:${fingerprint}`,evidence:{kind:'commander',authority:'observation_only',escalation,events:observation.events,guidance:observation.guidance}});
    await postSpans(ctx,[{...span,outcome:'unknown'}]);observation.central_delivery='submitted_unverified';
   }else observation.central_delivery='identity_unconfirmed';
   if((await ghJson(cfg,['pr','view',String(pr.number),'--json','state']))?.state!=='OPEN'){write(file,state);continue;}
   const reason=HANDLED.has(escalation.detail.type)?'independent_review_required':'infra_escalation';
   const title=`coding Commander待审：${prLabel(cfg,pr.number)}`,body=`${escalation.detail.type}｜${reason}；原规格、验收与预算保持生效`;
   const notified=await notifyBark(cfg,title,body);
   state.human={reason,at:new Date().toISOString(),escalation_at:escalation.detail.at??null,escalation_fingerprint:fingerprint,notified};
   write(file,state);ctx.log(`[coding-commander][P1] PR #${pr.number} 已记录观察并交主理人复核：${escalation.detail.type}`);
   return true;
  }
 }catch(error){ctx.log(`coding Commander观察失败：${String(error?.message??error).slice(0,300)}`);}
 return false;
}
