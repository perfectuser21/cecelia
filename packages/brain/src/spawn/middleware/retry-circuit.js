/**
 * retry-circuit middleware — Brain v2 Layer 3 attempt-loop 内循环第 f 步。
 * 见 docs/design/brain-orchestrator-v2.md §5.2。
 *
 * 职责：根据 runDocker result 判断失败类型（transient 可重试 vs permanent 不可重试），
 * 并给出本次 attempt 是否该进入下一次 attempt-loop 迭代。
 *
 * v2 P2 PR 6（本 PR）：建立模块 + 单测，暂不接线。attempt-loop 整合 PR 里接入。
 *
 * 失败分类（简单启发式）：
 *   - exit_code === 0                                                → success（不重试）
 *   - timed_out === true                                              → transient（重试）
 *   - stderr 含 ECONNREFUSED / ETIMEDOUT / ENETUNREACH / ECONNRESET   → transient
 *   - stderr 含 'Unable to find image' / 'manifest unknown'           → permanent
 *   - stderr 含 'No such container'                                   → permanent
 *   - exit_code === 124（timeout 标志）                                → transient
 *   - exit_code === 137（SIGKILL / OOM）                               → permanent
 *   - 其它 exit_code !== 0                                            → transient（默认）
 *
 * @param {object} result  runDocker 返回 { exit_code, stdout, stderr, timed_out, ... }
 * @returns {{ class: 'success'|'transient'|'permanent', reason: string|null }}
 */
const PERMANENT_PATTERNS = [
  /Unable to find image/i,
  /manifest unknown/i,
  /No such container/i,
  /container not found/i,
  /invalid reference format/i,
];

const TRANSIENT_PATTERNS = [
  /ECONNREFUSED/,
  /ETIMEDOUT/,
  /ENETUNREACH/,
  /ECONNRESET/,
  /socket hang up/i,
];

export function classifyFailure(result) {
  if (!result || typeof result !== 'object') {
    return { class: 'transient', reason: 'no-result' };
  }
  if (result.exit_code === 0) {
    return { class: 'success', reason: null };
  }
  if (result.timed_out === true || result.exit_code === 124) {
    return { class: 'transient', reason: 'timeout' };
  }
  if (result.exit_code === 137) {
    return { class: 'permanent', reason: 'oom-or-killed' };
  }
  const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
  for (const p of PERMANENT_PATTERNS) {
    if (p.test(combined)) {
      return { class: 'permanent', reason: `pattern:${p.source}` };
    }
  }
  for (const p of TRANSIENT_PATTERNS) {
    if (p.test(combined)) {
      return { class: 'transient', reason: `pattern:${p.source}` };
    }
  }
  return { class: 'transient', reason: `exit_code:${result.exit_code}` };
}

/**
 * 根据 classification + 当前 attempt 数判断是否继续下一次 attempt。
 *
 * @param {{ class: string }} classification  classifyFailure 返回值
 * @param {number} attemptIndex  当前是第几次 attempt（0-based）
 * @param {number} maxAttempts   最大 attempt 次数（默认 3）
 * @returns {boolean}
 */
export function shouldRetry(classification, attemptIndex, maxAttempts = 3) {
  if (!classification) return false;
  if (classification.class !== 'transient') return false;
  if (attemptIndex + 1 >= maxAttempts) return false;
  return true;
}
