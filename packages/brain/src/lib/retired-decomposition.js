export const RETIRED_DECOMPOSITION = 'retired_decomposition';

// 只拦截实际进入旧拆解路由或提示的标记；known 和普通任务不属于退役路径。
export function isRetiredDecomposition(task) {
  const payload = task?.payload;
  const taskType = task?.task_type || 'dev';
  const normalizedDev = taskType === 'harness_initiative' && payload?.requested_task_type === 'dev';
  // 这些专用执行面原本不读取旧拆解技能或提示，不能仅因同名字段拦截。
  if (['qiumi_task', 'script_run', 'staging_e2e', 'harness_intervention'].includes(taskType)) return false;
  if (taskType === 'harness_initiative' && !normalizedDev) return false;
  if (taskType === 'research' && (payload?.invocation || payload?.invocation_activity ||
      payload?.verification_transport === 'openclaw-agent-v1')) return false;
  return ['true', 'continue', 'okr'].includes(payload?.decomposition) ||
    payload?.next_action === 'decompose' ||
    (payload?.decomposition === true && (taskType === 'dev' || normalizedDev));
}

// 仅停放选择时仍未被领取、且 payload 未变的 queued 任务。
export async function parkRetiredDecomposition(db, task) {
  const result = await db.query(`
    UPDATE tasks SET status = 'blocked', blocked_at = NOW(),
      blocked_reason = $3, blocked_detail = $4::jsonb, blocked_until = NULL,
      updated_at = NOW()
    WHERE id = $1 AND status = 'queued' AND claimed_by IS NULL
      AND COALESCE(payload, '{}'::jsonb) = $2::jsonb
      AND task_type IS NOT DISTINCT FROM $5
    RETURNING id`,
  [task.id, JSON.stringify(task.payload || {}), RETIRED_DECOMPOSITION,
    JSON.stringify({ message: '旧任务拆解已退役，不会启动执行体' }), task.task_type ?? null]);
  return result.rowCount === 1 || result.rows?.length === 1;
}

// 若选中后 payload 才变为旧拆解，只能处理本次持有的精确认领。
export async function parkClaimedRetiredDecomposition(db, task, claimedBy, claimedAt) {
  const result = await db.query(`
    UPDATE tasks SET status = 'blocked', blocked_at = NOW(),
      blocked_reason = $3, blocked_detail = $4::jsonb, blocked_until = NULL,
      claimed_by = NULL, claimed_at = NULL, updated_at = NOW()
    WHERE id = $1 AND status = 'in_progress'
      AND COALESCE(payload, '{}'::jsonb) = $2::jsonb
      AND task_type IS NOT DISTINCT FROM $5
      AND claimed_by = $6 AND claimed_at = $7::timestamptz
    RETURNING id`,
  [task.id, JSON.stringify(task.payload || {}), RETIRED_DECOMPOSITION,
    JSON.stringify({ message: '旧任务拆解已退役，不会启动执行体' }),
    task.task_type ?? null, claimedBy, claimedAt]);
  return result.rowCount === 1 || result.rows?.length === 1;
}
