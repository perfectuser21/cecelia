/** 自动改进仅保留只读诊断；源码修补须由主理人明确登记开发任务。 */
import {createRoutedTask} from '../work-routing-store.js';
import {digest} from './commander-v2-contract.js';
import {diagnosisFacts} from './commander-diagnosis-facts.js';

const PROTOCOL='commander-improvement-v1';
const SHA=/^[a-f0-9]{40}$/;
const REPO=/^[\w.-]+\/[\w.-]+$/;
const reject=code=>{throw Object.assign(Error(code),{code});};
export const improvementKey=(e,fingerprint)=>digest([e.workflow_key,e.definition.runtime_snapshot_sha256,fingerprint]);

async function frozenSources(db,e){
 const {getRelease}=await import('./release-index.js');
 const release=await getRelease(db,e.definition.release_id),sources=[];
 const add=source=>{if(REPO.test(source?.repo||'')&&SHA.test(source?.revision||''))sources.push({repo:source.repo,revision:source.revision,...(typeof source.path==='string'&&source.path.length<=512?{path:source.path}:{})});};
 for(const c of release.payload.components||[])add(c);
 for(const a of release.payload.activities||[])for(const b of a.payload?.implementation_bindings||[]){add(b);add(b.resolved_source);}
 return [...new Map(sources.map(s=>[JSON.stringify(s),s])).values()].slice(0,200);
}
function safeEffects(c){
 const effects=c.delivery?.effects,v=c.verification;
 return Array.isArray(effects)&&v?.evidence?.length>0&&effects.every(effect=>['none','compensated'].includes(effect.status)
  ||v.assertions?.some(a=>a.name===`effect:${effect.key}`&&a.pass===true&&['none','compensated'].includes(a.status)&&a.evidence?.length>0));
}
function diagnosisSpec(task,c,failure,sources){
 const e=c.envelope,chain_key=improvementKey(e,failure.error_fingerprint);
 const chain={protocol:PROTOCOL,phase:'diagnosis',chain_key,max_diagnoses:1,max_repairs:0,max_dispatch_attempts:3,
  deadline_at:new Date(Date.now()+24*3600000).toISOString(),origin_task_id:task.id,origin_run_id:e.run_id,
  workflow_key:e.workflow_key,runtime_snapshot_sha256:e.definition.runtime_snapshot_sha256,
  error_fingerprint:failure.error_fingerprint,effects_safe:Boolean(safeEffects(c)),frozen_sources:sources};
 const context=diagnosisFacts(c,failure,sources);
 return {source:'scheduler',source_id:'commander-improvement:'+chain_key,requested_task_type:'research',mutation_intent:'read_only',declared_domain:'research',
  title:`只读诊断 ${e.workflow_key} ${chain_key.slice(0,16)}`,parent_task_id:task.id,
  description:`只读分析原运行及冻结来源，禁止修改Skill/代码/配置，禁止真实发布、重发、补偿或放宽权限。未知副作用先独立读回，不能重试。\n${JSON.stringify(context)}\n`
   +'分类只认 source_defect / external_environment / platform_risk_permission / verifier_defect / insufficient_evidence。失败不等于Skill缺陷。24小时内最多一份诊断。'
   +'自动修补和开发接棒已退役，next_steps仅允许note记录结论，或decision提交主理人拍板；禁止dispatch_headless、task或任何新任务派生。源码缺陷也只报告冻结来源、证据、复现与建议验收，不申请自动编码。'
   +'所附事实已脱敏且有界；truncated表示明细被裁剪，evidence引用不是证据正文。可用只读本地git show <冻结SHA>:<path>核对源码；无固定对象、引用不可读或证据不足时只写note，禁止联网fetch、推测源码或申请放宽沙箱。不要假定可GET Brain或远程证据。只读任务不用写库；最终答复最后一行必须输出 COMMANDER_DIAGNOSIS '+JSON.stringify({chain_key,origin_task_id:task.id,next_steps:[]})+'；next_steps只填note或decision。后续开发必须由主理人明确范围后另行登记人工批准任务，诊断本身不授予开发权限。',
  metadata:{lane:'AI',commander_improvement:chain},task:{status:'queued',priority:'P2',location:'xian',created_by:'commander-improvement',trigger_source:'brain_auto'}};
}

/** 调用方已经处于Commander事务；SQL异常必须回到保存点，不能毒化原验收事务。 */
export async function ensureCommanderImprovement(db,task,c,failure,deps={}){
 const chain_key=improvementKey(c.envelope,failure.error_fingerprint);
 const failed=Number((await db.query("SELECT count(*) AS n FROM task_events WHERE event_type='commander_improvement_dispatch_failed' AND payload->>'chain_key'=$1",[chain_key])).rows[0]?.n||0);
 if(failed>=3)return {status:'dispatch_budget_exhausted',chain_key};
 await db.query('SAVEPOINT commander_improvement_dispatch');
 try{
  const sources=await (deps.loadSources||frozenSources)(db,c.envelope);
  const spec=diagnosisSpec(task,c,failure,sources);
  const created=await (deps.createDiagnosis||((client,request)=>createRoutedTask(client,request,null,{transaction:'existing'})))(db,spec);
  if(!created.task?.id)reject('diagnosis_receipt_missing');
  await db.query('RELEASE SAVEPOINT commander_improvement_dispatch');
  return {status:'queued',task_id:created.task.id,chain_key,deduplicated:Boolean(created.deduplicated)};
 }catch(error){
  await db.query('ROLLBACK TO SAVEPOINT commander_improvement_dispatch');
  await db.query('RELEASE SAVEPOINT commander_improvement_dispatch');
  const code=String(error.code||'diagnosis_dispatch_failed').slice(0,100);
  const {event}=await import('./commander-v2-store.js');
  await event(db,task.id,'commander_improvement_dispatch_failed',{chain_key,code,actor:'commander-improvement'});
  return {status:'dispatch_failed',chain_key,code};
 }
}

/** 拦截旧在途诊断和旧repair链；不能靠改任务类型继续自主造单。 */
export function assertCommanderImprovementDispatchAllowed(task){
 if(task.payload?.commander_improvement)reject('commander_improvement_auto_repair_retired');
}

/** 运输回调已绑定本任务；只解析本协议的有界最终行，不执行AI返回的任意动作。 */
export function readCommanderDiagnosis(task){
 const chain=task.payload?.commander_improvement;
 if(chain?.protocol!==PROTOCOL||chain.phase!=='diagnosis')return null;
 const raw=task.payload?.last_run_result?.result_summary??task.result?.receipt?.text;
 if(typeof raw!=='string'||Buffer.byteLength(raw)>50000)return null;
 const line=[...raw.matchAll(/^COMMANDER_DIAGNOSIS[ \t]+(\{[^\n]*\})[ \t]*$/gm)].at(-1)?.[1];
 try{
  const parsed=JSON.parse(line);
  return parsed.chain_key===chain.chain_key&&parsed.origin_task_id===chain.origin_task_id
   &&Array.isArray(parsed.next_steps)&&parsed.next_steps.length<=1?parsed:null;
 }catch{return null;}
}
