/**
 * watchdog.js — Watchdog 边界规则（纯函数）
 *
 * Sprint 1b997ed6：过期 run 的 watchdog 只允许 fenced_terminal_cleanup，
 * 禁止 resume/requeue，禁止创建第二个 run。
 */

/**
 * watchdogShouldResume(run) → boolean
 * 判断 run 是否应被 watchdog 恢复（resume）。
 * 过期（有 terminal_reason 或 phase=failed/done）的 run 不得恢复。
 *
 * @param {{phase: string, terminal_reason: string|null}} run
 * @returns {boolean}
 */
export function watchdogShouldResume(run) {
  if (!run) return false;
  // 有 terminal_reason 的 run 不得 resume
  if (run.terminal_reason) return false;
  // phase=failed/done 的 run 不得 resume
  if (run.phase === 'failed' || run.phase === 'done') return false;
  return true;
}

/**
 * watchdogAction(run, decisionLog) → {action: string, reason: string, payload?: object}
 * 对过期 run 执行 fenced_terminal_cleanup；不得 resume/requeue/create_new_run。
 *
 * @param {{id: string, phase: string, terminal_reason: string|null}} run
 * @param {Array} decisionLog
 * @returns {{action: string, reason: string}}
 */
export function watchdogAction(run, decisionLog) {
  // 过期 run（有 terminal_reason 或 phase=failed）→ fenced_terminal_cleanup
  const isExpired = run.terminal_reason || run.phase === 'failed' || run.phase === 'done';
  if (isExpired) {
    const terminalReason = run.terminal_reason
      || (decisionLog ?? []).find((r) => r.action === 'terminal')?.detail?.terminal_reason
      || 'expired';
    return {
      action: 'fenced_terminal_cleanup',
      reason: terminalReason,
      // 明确不含 newRunId/createRun
    };
  }
  // 非过期 run：允许正常 resume 检查
  return { action: 'check_resume', reason: 'run_not_expired' };
}
