/** Workflow读模型：复用两张真实运行账，优先task_runs，绝不创建平行运行记录。 */
import {FAILURE_STATUSES,sanitizeWorkflowFailure} from '../lib/workflow-failure.js';
const WEEK = 7 * 86400000;
const labels = { pass:'success', success:'success', fail:'failed', failed:'failed', timeout:'timeout', running:'running', skipped:'skipped', cancelled:'cancelled', deferred:'deferred', queued:'派发完成', '派发完成':'派发完成' };
const terminal = new Set(['success','failed','timeout','cancelled','deferred','派发完成','skipped']);
const when = value => value == null ? NaN : new Date(value).getTime();
const revision = value => typeof value === 'string' && value ? value : '未知';

/** 任务回执只有run_id相同时才属于该次尝试；旧Run永不套用后来那次stdout。 */
export function receiptForRun(run, task) {
  const snapshot=run.context?.workflow_snapshot||{};
  const conflicting=receipt=>['run_id','runId'].some(k=>receipt[k]!=null&&receipt[k]!==run.run_id)
    ||['task_id','taskId'].some(k=>receipt[k]!=null&&receipt[k]!==run.task_id)
    ||[['workflow_id',run.workflow_id],['serial',snapshot.phone_serial],['phone_serial',snapshot.phone_serial],['source_revision',snapshot.source_revision]]
      .some(([key,expected])=>expected!=null&&receipt[key]!=null&&receipt[key]!==expected);
  if (run.result?.business_receipt) {
    const receipt=run.result.business_receipt;
    if(conflicting(receipt))return {};
    return receipt;
  }
  if (task?.script?.run_id !== run.run_id || typeof task.script.stdout !== 'string') return {};
  const lines = task.script.stdout.trim().split('\n');
  for (const line of lines.reverse()) {
    try {
      const receipt=JSON.parse(line);
      if (!receipt || typeof receipt!=='object' || Array.isArray(receipt)) continue;
      if(conflicting(receipt))continue;
      if ((receipt.run_id ?? receipt.runId)!=null && (receipt.run_id ?? receipt.runId)!==run.run_id) continue;
      if ((receipt.task_id ?? receipt.taskId)!=null && (receipt.task_id ?? receipt.taskId)!==run.task_id) continue;
      if (receipt.workflow_id!=null && run.workflow_id!=null && receipt.workflow_id!==run.workflow_id) continue;
      return receipt;
    } catch { /* 非JSON日志不当业务回执 */ }
  }
  return {};
}

export function observedRun(run, task) {
  const snapshot=run.context?.workflow_snapshot || {}, receipt=receiptForRun(run,task);
  const bound=run.definition_version || run.context?.bound_definition || {};
  let status=run.status || labels[run.outcome] || 'unknown';
  if (['success','pass'].includes(status)) {
    if (receipt.status==='deferred') status='deferred';
    else if (receipt.status==='skipped') status='skipped';
    else if (receipt.status==='queued') status='派发完成';
    else if (['failed','error','timeout','cancelled'].includes(receipt.status)) status=receipt.status==='error'?'failed':receipt.status;
    else if (!receipt.status && ['script','openclaw-agent'].includes(run.context?.source)) status='回执缺失';
  }
  return { id:run.id,run_id:run.run_id,task_id:run.task_id,workflow_id:run.workflow_id,ledger:run.ledger,
    notion_id:run.notion_id,status,started_at:run.started_at,ended_at:run.ended_at,
    duration_ms:run.duration_ms ?? (Number.isFinite(when(run.ended_at)) && when(run.ended_at)>=when(run.started_at) ? when(run.ended_at)-when(run.started_at):null),
    workflow_version:revision(snapshot.workflow_version || bound.version),
    definition_version_id:revision(snapshot.definition_version_id || bound.id || run.context?.definition_preflight?.workflow_definition_version_id),
    source_revision:revision(snapshot.source_revision || bound.source_commit || receipt.source_revision),control_source_revision:revision(snapshot.control_source_revision || receipt.control_source_revision),
    phone_serial:snapshot.phone_serial || receipt.serial || receipt.phone_serial || null,
    batch_task_id:snapshot.batch_task_id || receipt.batch_task_id || null,attempt:run.context?.attempt || snapshot.attempt || null,
    transport_status:run.status || run.outcome,exit_code:run.result?.exit_code ?? null,
    failure:FAILURE_STATUSES.has(status)&&FAILURE_STATUSES.has(receipt.status)?sanitizeWorkflowFailure(receipt.failure):null };
}

const codeLabel = kind => ({code:'纯代码',agent:'Agent',human:'人工'})[kind] || '未知';
/** 正文只放短摘要；完整诊断和所有证据仍属于同一Run账，通过真实Run链接追溯。 */
function failureSummary(failure){
  if(!failure)return null;
  const summary={};let truncated=failure.truncated===true;
  for(const [key,limit] of Object.entries({stage:128,code:128,message:1000,error_type:128,stderr:300})){
    if(typeof failure[key]!=='string')continue;
    summary[key]=failure[key].slice(0,limit);if(failure[key].length>limit)truncated=true;
  }
  if(failure.stdout||failure.host)truncated=true;
  if(failure.timeout_sec!=null)summary.timeout_sec=failure.timeout_sec;
  if(failure.exit_code!=null)summary.exit_code=failure.exit_code;
  if(Array.isArray(failure.evidence)){
    if(failure.evidence.length>3||failure.evidence.some(e=>e.length>180))truncated=true;
    summary.evidence=failure.evidence.slice(0,3).map(e=>e.slice(0,180));
  }
  summary.truncated=truncated;
  return summary;
}
export function workflowExecution(activities) {
  const kinds=[...new Set(activities.map(a=>a.executor_kind || a.contract?.executor_kind || 'unknown'))];
  const languages=[...new Set(activities.flatMap(a=>{
    const ref=a.contract?.implementation?.ref || a.description || '';
    return [ref.includes('.py')?'Python':null,/\.(mjs|js|ts)\b/.test(ref)?'Node.js':null,ref.includes('.swift')?'Swift':null].filter(Boolean);
  }))];
  return `${kinds.length>1?'混合':codeLabel(kinds[0])}${languages.length?` · ${languages.join(' / ')}`:''}`;
}

/** 固定数据库快照时间；左闭右闭7天窗口，future不能混入。分母明确而且零分母留空。 */
export function observeWorkflows(data) {
  const now=when(data.observed_at || new Date()),out=new Map();
  const taskById=new Map((data.task_records || []).map(t=>[t.id,t]));
  const dedup=new Map();
  for(const r of [...(data.run_records || [])].sort((a,b)=>(a.ledger==='task_runs'?0:1)-(b.ledger==='task_runs'?0:1))) {
    if(!dedup.has(r.run_id))dedup.set(r.run_id,observedRun(r,taskById.get(r.task_id)));
  }
  for(const workflow of data.workflows) {
    const runs=[...dedup.values()].filter(r=>r.workflow_id===workflow.id && when(r.started_at)<=now).sort((a,b)=>when(b.started_at)-when(a.started_at)||a.run_id.localeCompare(b.run_id));
    const tasks=[...new Map((data.task_records || []).filter(t=>t.workflow_id===workflow.id).map(t=>[t.id,t])).values()];
    // 高频runs账只取最近明细；其余记录在同一SQL快照聚合，统计仍覆盖完整窗口。
    const summary=(data.run_summaries || []).find(s=>s.workflow_id===workflow.id) || {};
    const additional=key=>Number(summary[key]) || 0;
    const recent=runs.filter(r=>when(r.started_at)>=now-WEEK),count=status=>recent.filter(r=>r.status===status).length;
    const success7=count('success')+additional('success7'),failed7=count('failed')+count('timeout')+additional('failed7'),eligible=success7+failed7;
    const attemptedTasks=[...new Set(recent.map(r=>r.task_id).filter(Boolean))];
    const completed=attemptedTasks.filter(id=>taskById.get(id)?.status==='completed' && ['success','派发完成'].includes(runs.find(r=>r.task_id===id)?.status)).length;
    const durations=recent.filter(r=>terminal.has(r.status)&&r.duration_ms!=null).map(r=>r.duration_ms);
    // 一个attempt可能有多个阶段Run；只有明确attempt编号才计重试，不把阶段数量猜成重试。
    const attempts=new Map();for(const r of recent)if(r.task_id) {
      const attempt=r.attempt ?? /^script-.*-a([1-9]\d*)$/.exec(r.run_id)?.[1];
      if(attempt!=null && Number.isInteger(Number(attempt)) && Number(attempt)>0) {
        if(!attempts.has(r.task_id))attempts.set(r.task_id,new Set());attempts.get(r.task_id).add(Number(attempt));
      }
    }
    const durationCount=durations.length+additional('duration_count');
    const stats={runs7:recent.length+additional('runs7'),success7,failed7,deferred7:count('deferred')+additional('deferred7'),cancelled7:count('cancelled')+additional('cancelled7'),running7:count('running')+additional('running7'),dispatch7:count('派发完成')+additional('dispatch7'),
      skipped7:count('skipped')+additional('skipped7'),unverified7:count('回执缺失'),queued:tasks.filter(t=>t.status==='queued').length,waiting:tasks.filter(t=>['blocked','paused'].includes(t.status)).length,
      retries7:[...attempts.values()].reduce((n,c)=>n+[...c].filter(a=>a>1).length,0),
      success_rate:eligible?success7/eligible:null,completed_task_rate:attemptedTasks.length?completed/attemptedTasks.length:null,
      attempted_tasks7:attemptedTasks.length,completed_tasks7:completed,avg_duration_ms:durationCount?(durations.reduce((a,b)=>a+b,0)+additional('duration_total_ms'))/durationCount:null,
      window_start:new Date(now-WEEK).toISOString(),window_end:new Date(now).toISOString(),
      policy:'尝试成功率=业务成功/(业务成功+失败+超时)，不计deferred/取消/运行中/派发完成/回执缺失；最终任务完成率=最新尝试业务成功或派发完成且task.completed的任务/窗口内有尝试的任务。批次仅计派发，单手机独立计数。'};
    const refs=(data.refs || []).filter(r=>r.active && r.workflow_id===workflow.id).sort((a,b)=>a.sequence_no-b.sequence_no);
    const activities=refs.map(r=>({...data.activities.find(a=>a.id===r.activity_id),sequence_no:r.sequence_no}));
    const entries=(data.entrypoints || []).filter(e=>e.workflow_id===workflow.id);
    const entrypoint=entries.length?entries.map(e=>`${e.enabled===false?'（已停）':''}${e.runtime_requires_llm===true?'Agent':e.runtime_requires_llm===false?'纯代码':'执行者未知'} · ${e.cron || e.schedule || '入口频率未知'} · ${e.name || ''}`).join('\n'):'启动入口未关联；不能据执行层推断入口为纯代码';
    const sources=[...new Set(activities.map(a=>a.contract?.implementation?.version || a.contract?.workflow_authoring?.source?.revision).filter(Boolean))];
    out.set(workflow.id,{workflow:{id:workflow.id,name:workflow.name,version:workflow.version || '未知',maintenance_owner:workflow.key?.includes('phone-account-patrol')?'主理人':'未登记'},
      version:workflow.version || '未知',deployment:`登记源码：${sources.join(' / ')||'未知'}；最新执行源码：${runs[0]?.source_revision || '未知'}；当前部署指针：未核验`,
      execution:workflowExecution(activities),entrypoint,activities:activities.map(a=>({name:a.name,sequence_no:a.sequence_no,executor_kind:a.executor_kind,source:a.contract?.implementation?.ref})),
      stats,recentRuns:runs.slice(0,20).map(r=>({...r,failure:failureSummary(r.failure)})),recentTasks:tasks.sort((a,b)=>when(b.created_at)-when(a.created_at)||a.id.localeCompare(b.id)).slice(0,20)
        .map(({script:_script,...task})=>task),
      last_started:runs[0]?.started_at || null});
  }
  return out;
}

/** SQL只读同一个source快照，不读取/投影凭据和整条任务指令。 */
export const WORKFLOW_OBSERVATION_PREFIX_SQL = `WITH
 task_associations AS (
   SELECT t.id AS task_id,w.id AS workflow_id FROM tasks t JOIN workflows w ON w.id::text=t.payload->>'workflow_id'
   UNION
   SELECT DISTINCT r.task_id,r.workflow_id FROM task_runs r JOIN workflows w ON w.id=r.workflow_id
 ),
 recent_task_ids AS (SELECT DISTINCT task_id FROM task_runs WHERE started_at>=now()-interval '7 days'),
 workflow_task_runs AS MATERIALIZED (
   SELECT r.*,w.id AS resolved_workflow_id FROM task_runs r JOIN tasks t ON t.id=r.task_id
   JOIN workflows w ON w.id::text=COALESCE(r.workflow_id::text,
     CASE WHEN NOT COALESCE(r.context->'workflow_snapshot' ? 'workflow_id',false)
       OR lower(r.context->'workflow_snapshot'->>'workflow_id')=t.payload->>'workflow_id' THEN t.payload->>'workflow_id' END)
   WHERE (r.started_at>=now()-interval '30 days' OR r.ended_at IS NULL) AND r.started_at<=now()
 ),
 eligible_legacy_runs AS MATERIALIZED (
   SELECT r.id,r.run_id,r.workflow_id,r.started_at,r.ended_at,r.outcome,r.duration_ms,r.notion_id,
     row_number() OVER(PARTITION BY r.workflow_id ORDER BY r.started_at DESC,r.run_id DESC) AS position
   FROM runs r WHERE r.workflow_id IS NOT NULL AND r.started_at>=now()-interval '30 days' AND r.started_at<=now()
     AND NOT EXISTS(SELECT 1 FROM workflow_task_runs tr WHERE tr.run_id=r.run_id)
 ) `;
export const WORKFLOW_OBSERVATION_SQL = `
 'observed_at',now(),
 'task_records',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'workflow_id',w.id,'title',t.title,'status',t.status,
   'notion_id',t.notion_id,'created_at',t.created_at,'parent_task_id',t.parent_task_id,
   'script',jsonb_build_object('run_id',t.result->'script'->>'run_id','stdout',t.result->'script'->>'stdout')))
   FROM task_associations a JOIN tasks t ON t.id=a.task_id JOIN workflows w ON w.id=a.workflow_id
   LEFT JOIN recent_task_ids recent ON recent.task_id=t.id
   WHERE t.created_at>=now()-interval '30 days' OR t.status IN ('queued','in_progress','blocked','paused')
     OR recent.task_id IS NOT NULL),'[]'::jsonb),
 'run_records',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
   SELECT r.id,r.run_id,r.task_id,r.resolved_workflow_id AS workflow_id,r.started_at,r.ended_at,r.status,NULL::text AS outcome,
     NULL::bigint AS duration_ms,r.result,COALESCE(r.context,'{}'::jsonb) || jsonb_build_object('bound_definition',
       jsonb_build_object('id',v.id,'version',v.payload->'contract'->>'version','source_commit',v.source_commit)) AS context,
     r.notion_id,'task_runs'::text AS ledger
     FROM workflow_task_runs r
     LEFT JOIN run_definition_bindings b ON b.run_id=r.run_id AND b.workflow_id=r.resolved_workflow_id
     LEFT JOIN workflow_definition_versions v ON v.id=b.workflow_definition_version_id AND v.workflow_id=b.workflow_id
   UNION ALL
   SELECT r.id,r.run_id,NULL::uuid,r.workflow_id,r.started_at,r.ended_at,NULL::text,r.outcome,r.duration_ms,
     '{}'::jsonb,jsonb_build_object('bound_definition',jsonb_build_object('id',v.id,'version',v.payload->'contract'->>'version','source_commit',v.source_commit)),
     r.notion_id,'runs'::text FROM eligible_legacy_runs r
     LEFT JOIN run_definition_bindings b ON b.run_id=r.run_id AND b.workflow_id=r.workflow_id
     LEFT JOIN workflow_definition_versions v ON v.id=b.workflow_definition_version_id AND v.workflow_id=b.workflow_id
     WHERE r.position<=20
 ) x),'[]'::jsonb),
 'run_summaries',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
   SELECT workflow_id,count(*) AS runs7,
     count(*) FILTER(WHERE outcome IN ('pass','success')) AS success7,
     count(*) FILTER(WHERE outcome IN ('fail','failed','timeout')) AS failed7,
     count(*) FILTER(WHERE outcome='cancelled') AS cancelled7,
     count(*) FILTER(WHERE outcome='running') AS running7,
     count(*) FILTER(WHERE outcome='skipped') AS skipped7,
     count(*) FILTER(WHERE outcome='deferred') AS deferred7,
     count(*) FILTER(WHERE outcome IN ('queued','派发完成')) AS dispatch7,
     count(duration_ms) FILTER(WHERE outcome IN ('pass','success','fail','failed','timeout','cancelled','deferred','queued','派发完成','skipped')) AS duration_count,
     COALESCE(sum(duration_ms) FILTER(WHERE outcome IN ('pass','success','fail','failed','timeout','cancelled','deferred','queued','派发完成','skipped')),0) AS duration_total_ms
   FROM eligible_legacy_runs WHERE position>20 AND started_at>=now()-interval '7 days' GROUP BY workflow_id
 ) x),'[]'::jsonb),
 'entrypoints',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'workflow_id',w.id,'name',r.title,'enabled',r.is_active,
   'cron',r.cron_expression,'runtime_requires_llm',r.template->'payload'->'runtime_requires_llm'))
   FROM recurring_tasks r JOIN workflows w ON w.id::text=r.template->'payload'->>'workflow_id'),'[]'::jsonb),`;
