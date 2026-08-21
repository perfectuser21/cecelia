/**
 * freshness-codes.js — Mapper freshness reason_code 确定性白名单（共享）
 *
 * diff-gate.js 与 structure-gate.js 在 `freshness.status !== 'fresh'` 折叠点透传
 * Mapper 真实 reason_code 时，用本模块判定该 reason_code 是「确定性 fail-closed」
 * 还是「瞬态可重试」，避免两处各自复制字面量导致漂移。
 *
 * 确定性 reason_code（→ retryable:false，fail-closed 终止）对齐 map/radius.js 产出的
 * 锚点/覆盖/引用类结论；瞬态类（快照/投影追赶）不在此集合，默认 retryable:true。
 * 白名单外未知 code 一律按瞬态处理（保守偏可重试，不误终止可自愈情形）。
 *
 * sprint: 08211839-kernel-949b0c61
 */

/**
 * 确定性 freshness reason_code 白名单（锚点/覆盖/引用类 → fail-closed）。
 * @type {Set<string>}
 */
export const DETERMINISTIC_FRESHNESS_REASON_CODES = new Set([
  'impact_anchor_missing',
  'capability_not_in_active_projection',
  'unsafe_assertion_ref',
  'assertion_identity_ambiguous',
  'capability_assertion_coverage_missing',
]);

/**
 * isDeterministicFreshnessReason(code) — 判定 reason_code 是否为确定性结论。
 *
 * 仅对已登记的确定性 reason_code 返回 true；null/undefined/空串/未知 code 一律
 * 返回 false（按瞬态处理，保守偏可重试）。
 *
 * @param {string|null|undefined} code
 * @returns {boolean}
 */
export function isDeterministicFreshnessReason(code) {
  return typeof code === 'string' && DETERMINISTIC_FRESHNESS_REASON_CODES.has(code);
}

export default {
  DETERMINISTIC_FRESHNESS_REASON_CODES,
  isDeterministicFreshnessReason,
};
