/** 改进沿现有任务接棒：先只读诊断，证据齐全才交一次开发，不修改在途实现。 */
import {createRoutedTask} from '../work-routing-store.js';
import {digest} from './commander-v2-contract.js';

const PROTOCOL='commander-improvement-v1';
const SHA=/^[a-f0-9]{40}$/;
const REPO=/^[\w.-]+\/[\w.-]+$/;
const nonempty=value=>typeof value==='string'&&value.trim().length>0;
const list=value=>Array.isArray(value)&&value.length>0&&value.every(nonempty);
const reject=code=>{throw Object.assign(Error(code),{code});};
export const improvementKey=(e,fingerprint)=>digest([e.workflow_key,e.definition.runtime_snapshot_sha256,fingerprint]);

async function frozenSources(db,e){
 const {getRelease}=await import('./release-index.js');
 const release=await getRelease(db,e.definition.release_id),sources=[];
 const add=source=>{if(REPO.test(source?.repo||'')&&SHA.test(source?.revision||''))sources.push({repo:source.repo,revision:source.revision});};
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
 const chain={protocol:PROTOCOL,phase:'diagnosis',chain_key,max_diagnoses:1,max_repairs:1,max_dispatch_attempts:3,
  deadline_at:new Date(Date.now()+24*3600000).toISOString(),origin_task_id:task.id,origin_run_id:e.run_id,
  workflow_key:e.workflow_key,runtime_snapshot_sha256:e.definition.runtime_snapshot_sha256,
  error_fingerprint:failure.error_fingerprint,effects_safe:Boolean(safeEffects(c)),frozen_sources:sources};
 const context={workflow_key:e.workflow_key,run_id:e.run_id,definition:e.definition.snapshot_sha256,release_id:e.definition.release_id,
  error_fingerprint:failure.error_fingerprint,reason:failure.reason,evidence:(c.verification?.evidence||[]).slice(0,20),frozen_sources:sources};
 return {source:'scheduler',source_id:'commander-improvement:'+chain_key,requested_task_type:'research',mutation_intent:'read_only',declared_domain:'research',
  title:`只读诊断 ${e.workflow_key} ${chain_key.slice(0,16)}`,parent_task_id:task.id,
  description:`只读分析原运行及冻结来源，禁止修改Skill/代码/配置，禁止真实发布、重发、补偿或放宽权限。未知副作用先独立读回，不能重试。\n${JSON.stringify(context)}\n`
   +'分类只认 source_defect / external_environment / platform_risk_permission / verifier_defect / insufficient_evidence。失败不等于Skill缺陷。24小时内最多一份诊断、一次开发接棒；没有确证则handoff只写note。'
   +'只有源码缺陷、独立副作用范围已确认安全且冻结来源、复现和验收齐全时，next_steps可交一条：'
   +JSON.stringify({kind:'dispatch_headless',title:'明确修复目标',change_kind:'bugfix',task_type:'coding_workflow',repo_hint:'冻结repo全名',map_scope_hint:['真实合法节点'],base_sha:'冻结40位SHA',
    diagnosis:{category:'source_defect',fixed_source:{repo:'冻结repo全名',revision:'冻结40位SHA',path:'实际相对路径'},evidence:['独立来源读回引用'],reproduction:'可复现输入与结果',acceptance:['修复效果与关键回归'],effects_status:'none或verified_safe'}})
   +'。必须从原release固定来源定位责任仓，不能猜父任务仓库。开发任务只走隔离分支、独立QA、PR与CI，不直接改生产。'
   +'只读任务不用写库；最终答复最后一行必须输出 COMMANDER_DIAGNOSIS '+JSON.stringify({chain_key,origin_task_id:task.id,next_steps:[]})+'；符合上述条件时把next_steps替换成该条结构化修补，无确证则写note。',
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

/** 只有本协议的只读诊断能申请一次修补；普通旧handoff保持既有行为。 */
export function improvementRepair(task,step){
 const chain=task.payload?.commander_improvement;
 if(!chain)return null;
 if(!['completed','completed_no_pr'].includes(task.status)||chain.protocol!==PROTOCOL||chain.phase!=='diagnosis'||chain.max_repairs!==1||!nonempty(chain.chain_key)
   ||!Number.isFinite(Date.parse(chain.deadline_at))||Date.parse(chain.deadline_at)<=Date.now())reject('commander_improvement_budget_exhausted');
 const d=step.diagnosis,source=d?.fixed_source;
 if(d?.category!=='source_defect'||!chain.effects_safe||!['none','verified_safe'].includes(d.effects_status)
   ||!list(d.evidence)||!nonempty(d.reproduction)||!list(d.acceptance))reject('commander_improvement_diagnosis_not_actionable');
 if(!REPO.test(source?.repo||'')||!SHA.test(source?.revision||'')||!nonempty(source?.path)
   ||source.path.startsWith('/')||source.path.split('/').some(p=>!p||p==='.'||p==='..')||source.path.includes('\\')
   ||!chain.frozen_sources?.some(s=>s.repo===source.repo&&s.revision===source.revision)
   ||step.repo_hint!==source.repo||step.base_sha!==source.revision||!list(step.map_scope_hint)||step.change_kind!=='bugfix')reject('commander_improvement_fixed_source_missing');
 return {source_id:'commander-repair:'+chain.chain_key,metadata:{commander_improvement:{...chain,phase:'repair'}},
  description:`复现：${d.reproduction}\n验收：${d.acceptance.join('；')}\n证据：${JSON.stringify(d.evidence)}\n固定源码：${JSON.stringify({repo:source.repo,revision:source.revision,path:source.path})}\n${step.detail||''}`};
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
