/** 旧任务入口只管理非底座任务；状态与固定运行身份归DBOS收账入口。 */
export const NON_FOUNDATION_TASK_SQL = "payload->>'commander_protocol' IS DISTINCT FROM 'commander-foundation-v1' AND NOT COALESCE(result ? 'foundation_runner',false)";
export function isFoundationTask(task) {
  return task?.payload?.commander_protocol === 'commander-foundation-v1'
    || Object.hasOwn(task?.result ?? {}, 'foundation_runner');
}
