/** 旧回调与历史路径定位共用的短任务标识。 */
/**
 * 取 taskId 前 8 位作为 shortid。不足 8 位抛错。
 * @param {string} taskId
 */
export function shortTaskId(taskId) {
  if (!taskId || String(taskId).length < 8) {
    throw new Error(`taskId must be ≥8 chars, got ${taskId}`);
  }
  return String(taskId).slice(0, 8);
}
