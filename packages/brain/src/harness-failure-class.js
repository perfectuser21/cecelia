/**
 * harness-failure-class.js — harness 失败可观测的枚举 SSOT。
 *
 * 法源: 决策 e8f6134f-4131-4145-a893-79eb098011d9（交付物2）
 * 合同: sprints/08101830-harness-failure-observability/contract-draft.md
 *
 * 所有把 harness_initiative / golden_path_proposal 打成 terminal（failed/blocked/
 * cancelled）的写入点，都必须经本模块把原始 reason 收敛成【冻结闭集】枚举成员写进
 * `tasks.result.failure_class`（枚举），原始自由文本落 `tasks.result.failure_detail`。
 * 未识别的原因兜底为 `unknown`，保证 `result->>'failure_class'` 永不为 null。
 *
 * 铁律：
 *   - FAILURE_CLASSES 是冻结闭集（Object.freeze），含 `unknown` 兜底成员。
 *   - failure_class 只接受闭集成员；failure_detail 才承载自由文本。
 *   - classifyFailure 未识别原因 → `unknown`（不得原样落自由文本进 failure_class）。
 *   - buildTerminalFailureResult 对非法 class 降级为 unknown，原始描述保进 failure_detail。
 */

/**
 * 冻结闭集 — harness terminal 失败根因枚举。
 * 新增成员只许追加（加成员不破坏 unknown 兜底），禁止删除既有成员。
 * @type {ReadonlyArray<string>}
 */
export const FAILURE_CLASSES = Object.freeze([
  'pipeline_terminal_failure', // 退役 harness task_type 被 subsume
  'missing_anchor',            // dispatcher S2 anchor gate（含 missing_gp_anchor）
  'missing_orchestrator_flag', // executor 缺 orchestrator flag
  'invalid_gear',              // executor 非法 gear
  'timeout',                   // relay_deadline_exceeded / *_deadline_exceeded / watchdog_deadline
  'no_progress',               // no_progress_same_sha / max_fresh_starts_exceeded / orphan_guard_exhausted
  'infra',                     // remote_bridge_prepare_* / network / runner_failure / infrastructure_blocked
  'process_crash',             // runtime_crash / kernel_process_fatal / code_error / pid_gone / liveness_dead
  'contract_invalid',          // 合同非法
  'evidence_insufficient',     // evidence_insufficient/invalid / product_failure / semantic_refusal / test_failure
  'dispatch_exception',        // dispatcher post-claim 异常
  'pre_flight_rejected',       // dispatcher 3+ strikes blocked
  'gate_violation',            // merged_without_evaluator_gate
  'needs_context',             // needs_context / env_skill_missing
  'cancelled',                 // 人工/系统取消
  'unknown',                   // 兜底 —— 保证 IS NULL 归零
]);

const FAILURE_CLASS_SET = new Set(FAILURE_CLASSES);

/**
 * 已知 raw reason → 枚举成员的精确映射表。
 * 只收敛「不是枚举成员本身」的原始 reason；枚举成员本身由 isValidFailureClass 直接放行。
 */
const RAW_REASON_MAP = Object.freeze({
  // timeout 家族
  relay_deadline_exceeded: 'timeout',
  generator_done_timeout: 'timeout',
  automation_deadline_exceeded: 'timeout',
  watchdog_deadline: 'timeout',
  deadline_exceeded: 'timeout',
  // no_progress 家族
  no_progress_same_sha: 'no_progress',
  max_fresh_starts_exceeded: 'no_progress',
  max_fresh_starts: 'no_progress',
  orphan_guard_exhausted: 'no_progress',
  // infra 家族
  network: 'infra',
  runner_failure: 'infra',
  infrastructure_blocked: 'infra',
  bridge_restart_orphaned: 'infra',
  no_executor: 'infra',
  // process_crash 家族
  runtime_crash: 'process_crash',
  kernel_process_fatal: 'process_crash',
  code_error: 'process_crash',
  pid_gone: 'process_crash',
  liveness_dead: 'process_crash',
  oom_killed: 'process_crash',
  oom_likely: 'process_crash',
  killed_signal: 'process_crash',
  process_disappeared: 'process_crash',
  orphan_detected: 'process_crash',
  // evidence 家族
  evidence_invalid: 'evidence_insufficient',
  product_failure: 'evidence_insufficient',
  semantic_refusal: 'evidence_insufficient',
  test_failure: 'evidence_insufficient',
  // gate 家族
  merged_without_evaluator_gate: 'gate_violation',
  // needs_context 家族
  env_skill_missing: 'needs_context',
  // anchor 家族
  missing_gp_anchor: 'missing_anchor',
  // contract 家族
  contract_error: 'contract_invalid',
  // cancelled 家族
  canceled: 'cancelled',
});

// 前缀匹配兜底（如 remote_bridge_prepare_http_503 / remote_bridge_prepare_* 一律 infra）。
const RAW_REASON_PREFIX = Object.freeze([
  ['remote_bridge_prepare', 'infra'],
  ['bridge_', 'infra'],
]);

/**
 * 是否为闭集枚举成员（严格：只接受 FAILURE_CLASSES 内的字符串）。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidFailureClass(value) {
  return typeof value === 'string' && FAILURE_CLASS_SET.has(value);
}

/**
 * 把原始 failure reason 收敛为闭集枚举成员。
 * - null/undefined/'' → 'unknown'
 * - 本身即枚举成员 → 原样返回
 * - 精确映射表命中 → 映射值
 * - 前缀兜底命中 → 对应枚举
 * - 其余一律 → 'unknown'（不得原样返回自由文本）
 * @param {unknown} rawReason
 * @returns {string} 一定是 FAILURE_CLASSES 的成员
 */
export function classifyFailure(rawReason) {
  if (typeof rawReason !== 'string' || rawReason.trim() === '') return 'unknown';
  const key = rawReason.trim();
  if (FAILURE_CLASS_SET.has(key)) return key;
  if (Object.prototype.hasOwnProperty.call(RAW_REASON_MAP, key)) return RAW_REASON_MAP[key];
  for (const [prefix, cls] of RAW_REASON_PREFIX) {
    if (key.startsWith(prefix)) return cls;
  }
  return 'unknown';
}

/**
 * 构造 terminal 失败的 result 补丁对象（供各写入点合并进 tasks.result）。
 * - failureClass 非法 → 降级为 'unknown'（永不落自由文本进 failure_class）
 * - failureDetail 承载原始自由文本；为空时回退成 failure_class，保证 detail 非空
 * - existingResult 会被浅合并保留（失败字段覆盖同名 key）
 * @param {{ failureClass?: string, failureDetail?: string, existingResult?: object }} params
 * @returns {{ failure_class: string, failure_detail: string }}
 */
export function buildTerminalFailureResult({ failureClass, failureDetail, existingResult } = {}) {
  const cls = isValidFailureClass(failureClass) ? failureClass : 'unknown';
  let detail = failureDetail == null ? '' : String(failureDetail);
  if (detail.trim() === '') detail = cls;
  const base = existingResult && typeof existingResult === 'object' ? existingResult : {};
  return {
    ...base,
    failure_class: cls,
    failure_detail: detail,
  };
}
