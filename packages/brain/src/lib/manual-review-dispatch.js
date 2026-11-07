import { randomUUID } from 'node:crypto';
import { transferReviewSkillPlan } from './review-skill-plan.js';

// 所有权和微秒时间戳必须一起匹配，避免旧请求清理新认领。
async function releaseOwnedReview(db, task, owner, stamp, lock) {
  if (lock?.acquired && !lock.acquisitionVersion) return { unknown: true };
  const result = await db.query(`WITH owned AS MATERIALIZED (
    SELECT id FROM tasks WHERE id=$1 AND claimed_by=$2 AND claimed_at=$3::timestamptz
      AND status IN ('queued','in_progress') FOR UPDATE
  ), unlocked AS (
    UPDATE device_locks SET locked_by=NULL,locked_at=NULL,expires_at=NULL
      WHERE device_name=$4 AND locked_by=$1::text AND xmin::text=$5
        AND EXISTS (SELECT 1 FROM owned) RETURNING device_name
  ), released AS (
    UPDATE tasks SET status='queued',claimed_by=NULL,claimed_at=NULL,updated_at=NOW()
      WHERE id=$1 AND EXISTS (SELECT 1 FROM owned)
        AND (NOT $6::boolean OR EXISTS (SELECT 1 FROM unlocked))
      RETURNING id
  ) SELECT (SELECT count(*) FROM released)::int AS released,
           (SELECT count(*) FROM unlocked)::int AS unlocked`,
  [task.id,owner,stamp,lock?.serial ?? null,lock?.acquisitionVersion ?? null,Boolean(lock?.acquired)]);
  const released=result.rows[0]?.released === 1;
  return {released, unlocked:result.rows[0]?.unlocked === 1, unknown:Boolean(lock?.acquired) && !released};
}

// 仅用于实际消费账本 skill 的审查任务；其余手动派发保持现行执行面。
export async function dispatchManualRegistryReview(task, pool, deps) {
  const owner=`manual-review:${randomUUID()}`;
  let stamp=null, lock=null, starting=false, gatePending=false;
  const response=(status,body)=>({status,body});
  const unknown=()=>response(503,{error:'dispatch_state_unknown',detail:'任务认领或设备锁状态未知，未作无条件清理'});
  const release=()=>releaseOwnedReview(pool,task,owner,stamp,lock);
  try {
    if (!task.dispatch_row_version) return unknown();
    const claimed=await pool.query(`UPDATE tasks SET claimed_by=$2,claimed_at=clock_timestamp(),updated_at=NOW()
      WHERE id=$1 AND status='queued' AND claimed_by IS NULL AND claimed_at IS NULL
        AND COALESCE(payload,'{}'::jsonb)=$3::jsonb AND task_type IS NOT DISTINCT FROM $4
        AND xmin::text=$5
      RETURNING claimed_at::text AS claim_stamp, xmin::text AS claim_version`,[task.id,owner,JSON.stringify(task.payload ?? {}),task.task_type ?? null,task.dispatch_row_version]);
    stamp=claimed.rows[0]?.claim_stamp;
    if (!stamp) return response(409,{error:'task_changed_before_dispatch'});
    gatePending=true;
    const gate=await deps.deviceGate(task,deps.tag);
    gatePending=false;
    if (!gate.pass) {
      if (gate.uncertain) return unknown();
      const released=await release();
      return released.released ? response(gate.status,gate.body) : response(409,{error:'task_claim_changed'});
    }
    lock={acquired:gate.acquired,serial:task.payload?.device_serial ?? null,acquisitionVersion:gate.acquisitionVersion ?? null};
    if (deps.checkAvailable) {
      const available=await deps.checkAvailable(task);
      if (!available.available) {
        const released=await release();
        if (released.unknown) return unknown();
        return released.released ? response(503,{error:'executor not available',detail:available.error}) : response(409,{error:'task_claim_changed'});
      }
    }
    const started=await pool.query(`UPDATE tasks SET status='in_progress'${deps.tag === 'dispatch-now' ? ',started_at=NOW()' : ''},
      updated_at=NOW()${deps.tag === 'dispatch-now' ? '' : ",metadata=COALESCE(metadata,'{}'::jsonb)||'{\"manually_dispatched\":true}'::jsonb"}
      WHERE id=$1 AND status='queued' AND claimed_by=$2 AND claimed_at=$3::timestamptz
        AND COALESCE(payload,'{}'::jsonb)=$4::jsonb AND task_type IS NOT DISTINCT FROM $5
        AND xmin::text=$6
      RETURNING id,xmin::text AS started_version`,[task.id,owner,stamp,JSON.stringify(task.payload ?? {}),task.task_type ?? null,claimed.rows[0]?.claim_version ?? null]);
    if (!started.rows.length) {
      const released=await release();
      return released.unknown ? unknown() : response(409,{error:'task_changed_before_execution'});
    }
    const current=await pool.query(`SELECT * FROM tasks WHERE id=$1 AND status='in_progress'
      AND claimed_by=$2 AND claimed_at=$3::timestamptz AND xmin::text=$4`,
    [task.id,owner,stamp,started.rows[0]?.started_version ?? null]);
    if (!current.rows.length) {
      const released=await release();
      return released.unknown ? unknown() : response(409,{error:'task_changed_before_execution'});
    }
    const executionTask=transferReviewSkillPlan(task,current.rows[0]);
    if (!executionTask) {
      const released=await release();
      return released.unknown ? unknown() : response(409,{error:'task_changed_before_execution'});
    }
    starting=true;
    const result=await deps.trigger(executionTask);
    if (!result.success) {
      // 这两种返回均在 review 启动进程之前；仅在仍持有原认领和原设备锁版本时回队。
      if (result.reason === 'codex_review_pool_full' || result.reason === 'codex_binary_missing') {
        const released=await release();
        if (!released.released) return unknown();
        return response(503,{error:result.reason,detail:result.detail ?? result.error});
      }
      // 通用失败不能证明未启动；保留占用并交对账，绝不伪造安全回队。
      return response(503,{error:result.reason ?? 'dispatch_state_unknown',execution_state:'unknown'});
    }
    if (deps.tag==='dispatch-now') return response(200,{success:true,taskId:task.id,runId:result.runId,executor:result.executor ?? 'local'});
    return response(202,{task_id:task.id,title:task.title,run_id:result.runId,dispatched_at:new Date().toISOString()});
  } catch (error) {
    if (starting || gatePending) return unknown();
    if (!stamp) return unknown();
    try {
      const released=await release();
      if (released.unknown) return unknown();
      if (!released.released) return response(409,{error:'task_claim_changed'});
    } catch { return unknown(); }
    return response(503,{error:'dispatch_preflight_failed',detail:String(error.message || error)});
  }
}
