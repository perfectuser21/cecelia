/** 四独立获客调用合同。执行263正式CLI；不使用旧wf-launch/LLM Commander。 */
import { resolveWorkflowConfig } from './factory-workflow-config.js';
import { getRelease, getReleaseGate, UUID } from './release-index.js';
import { getRunDefinitionBinding } from './run-definition-binding.js';
export const LEADGEN_KEYS = ['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring','douyin_lead_outreach'];
const TOKEN=/^[A-Za-z0-9_-]{1,100}$/;
const requireValue=(ok,message)=>{if(!ok)throw Error(`leadgen_dispatch: ${message}`);};
export const isLeadgenTask=t=>LEADGEN_KEYS.includes(t?.payload?.workflow_key);
export function resolveLeadgenInput(task) {
  const key=task?.payload?.workflow_key, cfg=resolveWorkflowConfig(key), p=task?.payload?.leadgen;
  requireValue(LEADGEN_KEYS.includes(key)&&cfg?.dispatch_via==='leadgen-run-v1','未登记入口');
  requireValue(UUID.test(task.id||'')&&p&&typeof p==='object'&&!Array.isArray(p),'任务或输入无效');
  requireValue(Object.keys(p).every(k=>['line','company_id','profile','serial','source_run','source_binding_run_id','limit','comment_limit','send_authorized'].includes(k)),'含未批准输入');
  requireValue(TOKEN.test(p.line||'')&&UUID.test(p.company_id||''),'公司身份不完整');
  const scoring=key===LEADGEN_KEYS[2];
  requireValue(key===LEADGEN_KEYS[3]?p.send_authorized===true:p.send_authorized===undefined,'触达须有本次明确发送授权');
  if(scoring)requireValue(p.profile===undefined&&p.serial===undefined,'评分不得借用手机身份');
  else requireValue(TOKEN.test(p.profile||'')&&TOKEN.test(p.serial||''),'须显式选择登记手机');
  const limit=p.limit??(key===LEADGEN_KEYS[3]?1:5);
  requireValue(Number.isSafeInteger(limit)&&limit>0&&limit<=cfg.leadgen.max_limit,'数量越界');
  const env={LEADGEN_LIMIT:String(limit),WF_MMV_SSH_ROUTE:'public'};
  if(key===LEADGEN_KEYS[1]||scoring){
    const upstream=key===LEADGEN_KEYS[1]?LEADGEN_KEYS[0]:LEADGEN_KEYS[1];
    requireValue(TOKEN.test(p.source_run||'')&&!/^commentbench/i.test(p.source_run),'须显式真实上游批次');
    requireValue(typeof p.source_binding_run_id==='string'&&new RegExp(`^${upstream}-${p.source_run}__a[1-9][0-9]*$`).test(p.source_binding_run_id),'上游绑定身份错误');
    env.LEADGEN_SOURCE_RUN=p.source_run;
  }else requireValue(p.source_run===undefined&&p.source_binding_run_id===undefined,'此入口不接受上游批次覆盖');
  if(p.comment_limit!==undefined){requireValue(key===LEADGEN_KEYS[1]&&Number.isSafeInteger(p.comment_limit)&&p.comment_limit>=1&&p.comment_limit<=50,'评论数量无效');env.LEADGEN_COMMENT_LIMIT=String(p.comment_limit);}
  const business_tag=`brain${task.id.replaceAll('-','')}`;
  return {task_id:task.id,controller_run_id:`wfd-${task.id}`,workflow_key:key,workflow_id:cfg.leadgen.workflow_id,
    business_tag,business_run_id:`${key}-${business_tag}__a1`,machine:scoring?'mmv':'xian-m4',profile:scoring?'mmv-scoring':p.profile,
    serial:scoring?'none':p.serial,line:p.line,company_id:p.company_id,env,timeout_sec:cfg.leadgen.timeout_sec,
    source_binding_run_id:p.source_binding_run_id,...(p.send_authorized===true?{send_authorized:true}:{})};
}
export async function prepareLeadgenPlan(pool,task,deps={}) {
  const plan=resolveLeadgenInput(task), explicit=task.payload.workflow_definition;
  const row=(await pool.query('SELECT * FROM workflows WHERE id=$1',[plan.workflow_id])).rows[0];
  requireValue(row?.key===plan.workflow_key,'正式Workflow不匹配');
  if(row.status==='paused')return {waiting:true,reason:'workflow_paused'};
  requireValue(row.status==='active','正式Workflow未激活');
  requireValue(explicit&&UUID.test(explicit.release_id||'')&&UUID.test(explicit.observation_id||''),'缺显式固定发布与观测');
  const release=await (deps.getRelease??getRelease)(pool,explicit.release_id);
  const gate=await (deps.getReleaseGate??getReleaseGate)(pool,release.id);
  requireValue(release.environment==='production'&&release.target===plan.machine&&gate.deployed&&gate.actual_matches&&Array.isArray(gate.gaps)&&gate.gaps.length===0&&gate.current_observation_id===explicit.observation_id,'当前真实部署不符');
  const fixed=release.payload.workflows.find(w=>w.workflow_id===plan.workflow_id&&w.id===row.current_definition_version_id&&w.id===explicit.workflow_definition_version_id&&w.payload_sha256===explicit.snapshot_sha256);
  requireValue(fixed,'当前完整固定版本不符');
  if(plan.machine!=='mmv'){
    const phone=(await pool.query('SELECT * FROM phone_registry WHERE serial=$1',[plan.serial])).rows[0];
    requireValue(phone?.enabled&&phone.host==='xian-m4'&&phone.profile===plan.profile,'手机台账身份不符');
  }
  if(plan.source_binding_run_id){
    const upstream=await (deps.getBinding??getRunDefinitionBinding)(pool,plan.source_binding_run_id);
    const expected=plan.workflow_key===LEADGEN_KEYS[1]?'b1000000-0000-4000-8000-000000000101':'b1000000-0000-4000-8000-000000000102';
    requireValue(upstream?.binding.source_kind==='external'&&upstream.workflow.workflow_id===expected&&upstream.workflow.source_commit===fixed.source_commit,'上游不是同源正式批次');
  }
  return {...plan,release_id:release.id,observation_id:explicit.observation_id,workflow_definition_version_id:fixed.id,snapshot_sha256:fixed.payload_sha256,source_commit:fixed.source_commit};
}
