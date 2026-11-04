/**
 * Harness 公用工具（小而纯，便于单测注入）。
 *
 * 当前导出：
 *   - makeCpBranchName(taskId, { now }) — 生成符合 branch-protect 规约的分支名
 */

/**
 * 返回上海时区（UTC+8）的 MMDDHHMM 8 位字符串。
 * @param {Date} [date]
 */
export function shanghaiMMDDHHMM(date = new Date()) {
  // 直接加 8h offset 再取 UTC 字段，避开本机时区差异（CI 在 UTC）
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getUTCDate()).padStart(2, '0');
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mi = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${mm}${dd}${hh}${mi}`;
}

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

/**
 * 生成 Harness worktree 的 cp-* 分支名，满足 `hooks/branch-protect.sh`
 * 的正则 `^cp-[0-9]{8,10}-[a-z0-9][a-z0-9_-]*$`，并且符合 CI `branch-naming`
 * 检查（以 `cp-` 开头）。
 *
 * 格式：`cp-<MMDDHHMM>-ws-<taskId8>`  例如 `cp-04240814-ws-abcdef12`
 *
 * @param {string} taskId            Brain task id（uuid 等），至少 8 字符
 * @param {object} [opts]
 * @param {Date|number} [opts.now]   测试注入
 * @returns {string}
 */
export function makeCpBranchName(taskId, opts = {}) {
  const sid = shortTaskId(taskId);
  const when = opts.now instanceof Date
    ? opts.now
    : (typeof opts.now === 'number' ? new Date(opts.now) : new Date());
  const ts = shanghaiMMDDHHMM(when);
  return `cp-${ts}-ws-${sid}`;
}
