/** 秋米只走原生路由；保留决策落库与人控停放，不派生设备子任务。 */
import {finalizeTask} from '../lib/task-terminal.js';
import {routeNativeQiumiTask} from './native-qiumi-route.js';
export function routeQiumiTask(task,deps){
  return routeNativeQiumiTask(task,deps);
}

export async function persistDecision(pool, task, decision) {
  if(decision.outcome==='blocked'){
    await pool.query(`UPDATE tasks SET status='blocked',blocked_reason=$2::varchar,error_message=$2::text,blocked_at=NOW(),blocked_until=NULL,claimed_by=NULL,claimed_at=NULL,updated_at=NOW() WHERE id=$1 AND status='queued'`,[task.id,decision.reason]);
    return;
  }
  if (decision.outcome === 'agent') {
    // kind / department 落真列（迁移 466 / 066，决策 df67a9d6）：与 payload 同一条 UPDATE，
    // 不另起一条——421 触发器只盯 task_type/payload，加两个普通列不会换个理由抛。
    await pool.query(
      `UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb, kind = $3, dept = $4, updated_at = NOW() WHERE id = $1`,
      [task.id, JSON.stringify(decision.payloadPatch), decision.kind ?? null, decision.department ?? null],
    );
    return;
  }
  if (decision.outcome === 'unresolved') {
    await holdUnresolved(pool, task, decision);
    return;
  }
  await finalizeTask(pool, task.id, 'failed', {
    set: { error_message: decision.detail ? `${decision.reason}: ${decision.detail}` : decision.reason },
    onlyIfStatus: 'queued',
  });
}

function holdUnresolved(pool, task, decision) {
  return pool.query(
    `UPDATE tasks
        SET status = 'blocked', blocked_at = NOW(), blocked_reason = 'device_unresolved', blocked_until = NULL,
            blocked_detail = $2::jsonb, error_message = $3,
            claimed_by = NULL, claimed_at = NULL, updated_at = NOW()
      WHERE id = $1 AND status = 'queued'`,
    [task.id, JSON.stringify(decision.detail ?? {}), decision.note ?? null],
  );
}
