/** 六活动的服务端状态只能由 authoring store 写入，通用任务接口不能代写。 */
export function authoringMutationError(task, { status, result } = {}) {
  if (result && Object.hasOwn(result, 'workflow_control')) return { success: false, code: 'COMMANDER_CONTROL_RESERVED', error: 'workflow_control只能由通用Commander控制器写入' };
  if (task?.payload?.commander_protocol === 'commander-v2' && status !== undefined) return { success: false, code: 'COMMANDER_CONTROL_OWNED', error: 'commander-v2任务状态由通用控制器管理，请走内部事件接口' };
  if (result && typeof result === 'object' && Object.hasOwn(result, 'workflow_authoring')) {
    return { success: false, code: 'WORKFLOW_AUTHORING_RESERVED', error: 'workflow_authoring 是服务端保留字段，请使用六活动提交接口' };
  }
  const state = task?.result?.workflow_authoring;
  if ((task?.payload?.workflow_authoring === true || state)
    && ['completed', 'completed_no_pr'].includes(status)
    && !(state?.stage === 'completed' && state?.outputs?.register?.readback_verified === true)) {
    return { success: false, code: 'WORKFLOW_AUTHORING_INCOMPLETE', error: '六活动尚未完成登记回读，不能完成管理任务' };
  }
  return null;
}

/** where/参数只由调用方构造，批量动作须在写入任何一行之前检查全部命中任务。 */
export async function assertAuthoringCompletion(db, status, where, params) {
  if (status === undefined) return;
  const { rows } = await db.query(`SELECT id, payload, result FROM tasks WHERE (${where})
    AND (payload->'workflow_authoring' = 'true'::jsonb OR result ? 'workflow_authoring' OR payload->>'commander_protocol'='commander-v2')`, params);
  for (const task of rows) {
    const error = authoringMutationError(task, { status });
    if (error) throw Object.assign(new Error(error.error), { ...error, status: 409, statusCode: 409 });
  }
}
