/**
 * retry-classification.js — Diff/Structure Gate 不可判定 reason 的瞬态/终态分流。
 *
 * 背景：Gate 曾把 Mapper 的确定性终态结论（稳定的 digest/revision mismatch，重试永不
 * 收敛）标成 retryable:true，导致 attempt 反复落 deny:impact:* 被无限重派、run 空转。
 *
 * 分流规则（CONTRACT IS LAW，见 sprints/08211504-kernel-e9e0db8f/contract-draft.md）：
 *   - 瞬态白名单（基础设施类，重试可能收敛）→ retryable:true
 *   - 其余（确定性终态 digest/revision mismatch、未知/未枚举 reason）→ retryable:false（fail-closed）
 *
 * 两个 Gate 共用同一份白名单以保证同源对齐，避免只修一半。
 */

/**
 * 瞬态 reason 白名单：这些是基础设施类不可达/未就绪，重试可能收敛。
 * 白名单外的一律按确定性终态处理（保守 fail-closed）。
 */
export const TRANSIENT_REASONS = new Set([
  'mapper_unavailable',
  'db_unavailable',
  'mapper_stale',
  'revision_evidence_missing',
  'git_diff_unavailable',
  'contract_extend_write_failed',
  'gap_ledger_write_failed',
]);

/**
 * isRetryableReason(reason) — reason 是否属于瞬态（可重试）。
 * 白名单内 → true；确定性终态 / 未知 reason → false（fail-closed）。
 *
 * @param {string} reason
 * @returns {boolean}
 */
export function isRetryableReason(reason) {
  return TRANSIENT_REASONS.has(reason);
}

export default { TRANSIENT_REASONS, isRetryableReason };
