/**
 * failure-class.js —— harness terminal 失败的受控枚举单一来源 + 统一落库助手。
 *
 * 法源：决策 e8f6134f（交付物2）。近30天 harness_initiative failed 274 条，其中 241 条
 * result 为 null（失败原因缺失率 ~88%）。本模块把散落在 executor/loop/dispatcher/
 * watchdog/death-handlers 的 failure_class 字面量收敛成【唯一 frozen 源】，并提供
 * persistTerminalFailure 作为「代码 ↔ tasks.result」写路径的单一入口，使
 * GET /api/brain/harness/failure-stats 能按 result->>'failure_class' 收敛失败率。
 *
 * CONTRACT IS LAW：各写入点只许引用本模块导出的 FAILURE_CLASSES，禁散落裸字面量；
 * 非枚举值经 assertFailureClass 抛错（fail-closed，不接受自由文本进 result.failure_class）。
 */

import { redactSecrets } from './failure-persistence.js';

/**
 * 受控枚举（frozen）。收敛现有散落字面量 + 各 terminal 写入点实证增补成员。
 * 全部成员必须来自本数组这一个源——新增写入点需要新类别时在此追加，禁在各文件写裸字面量。
 */
export const FAILURE_CLASSES = Object.freeze([
  // ── 合同定稿清单（覆盖已枚举写入点）──
  'timeout',
  'runtime_crash',
  'network',
  'infrastructure_blocked',
  'product_failure',
  'evidence_invalid',
  'contract_invalid',
  'max_fresh_starts_exceeded',
  'watchdog_deadline',
  'liveness_dead',
  'pipeline_terminal_failure',
  'missing_anchor',
  'dispatch_fail_autoblock',
  'pre_flight_rejected',
  'recovery_without_session',
  'invalid_gear',
  'unknown',
  // ── 写入点实证增补（均归本 frozen 源；见 executor.js/dispatcher.js/watchdog）──
  'missing_orchestrator_flag',
  'missing_gp_anchor',
  'relay_deadline_exceeded',
]);

const FAILURE_CLASS_SET = new Set(FAILURE_CLASSES);

/**
 * 成员判定。
 * @param {unknown} x
 * @returns {boolean}
 */
export function isValidFailureClass(x) {
  return typeof x === 'string' && FAILURE_CLASS_SET.has(x);
}

/**
 * 非枚举值抛错（fail-closed）。
 * @param {unknown} x
 * @returns {void}
 */
export function assertFailureClass(x) {
  if (!isValidFailureClass(x)) {
    throw new Error(`invalid failure_class: ${x}`);
  }
}

/**
 * 构造落库用 result patch。先 assertFailureClass，failure_detail 经 redactSecrets 脱敏
 * （复用 failure-persistence 的同一份脱敏正则；null/undefined 保持 null，不强转 'unknown'）。
 * @param {string} failureClass - 必填且必须 ∈ FAILURE_CLASSES
 * @param {string|null|undefined} failureDetail - 自由文本，允许空
 * @returns {{failure_class: string, failure_detail: string|null}}
 */
export function buildFailureResultPatch(failureClass, failureDetail) {
  assertFailureClass(failureClass);
  const detail = (failureDetail === null || failureDetail === undefined)
    ? null
    : redactSecrets(String(failureDetail));
  return { failure_class: failureClass, failure_detail: detail };
}

/**
 * 从自由文本 reason 推导受控 failure_class（供 kernel/loop 等只有 reason 字符串的收敛点用）。
 * 命不中任何已知前缀 → 'unknown'（合法枚举兜底，reason 原文进 failure_detail 保真）。
 * @param {string|null|undefined} reason
 * @returns {string} ∈ FAILURE_CLASSES
 */
export function deriveFailureClassFromReason(reason) {
  const r = String(reason ?? '').toLowerCase();
  if (isValidFailureClass(r)) return r;
  if (r.includes('deadline') || r.includes('timeout')) return 'watchdog_deadline';
  if (r.includes('infrastructure')) return 'infrastructure_blocked';
  if (r.includes('evidence')) return 'evidence_invalid';
  if (r.includes('contract')) return 'contract_invalid';
  if (r.includes('anchor')) return 'missing_anchor';
  if (r.includes('recovery_without_session') || r.includes('no_session')) return 'recovery_without_session';
  if (r.includes('blocked_same_state') || r.includes('product')) return 'product_failure';
  if (r.includes('crash') || r.includes('exception')) return 'runtime_crash';
  return 'unknown';
}

/**
 * 纯聚合函数：把 [{failure_class, is_terminal_failed}] 折算成失败率口径。
 * - by_class：仅统计 is_terminal_failed 行，按 failure_class（缺省归 'unknown'）计数。
 * - 滚动失败率 = failed / (failed + done)，两位小数；分母为 0 → 0（禁负分母/NaN）。
 * 供 failure-stats endpoint 复用，可脱库单测（口径接线可测锚点，INV-1）。
 * @param {Array<{failure_class: string|null, is_terminal_failed: boolean}>} rows
 * @returns {{by_class: Record<string,number>, total_terminal_failed: number, total_terminal_done: number, failure_rate: number}}
 */
export function computeFailureStats(rows) {
  const by_class = {};
  let total_terminal_failed = 0;
  let total_terminal_done = 0;
  for (const row of rows || []) {
    if (row && row.is_terminal_failed) {
      total_terminal_failed += 1;
      const cls = row.failure_class || 'unknown';
      by_class[cls] = (by_class[cls] || 0) + 1;
    } else {
      total_terminal_done += 1;
    }
  }
  const denom = total_terminal_failed + total_terminal_done;
  const failure_rate = denom > 0
    ? Math.round((total_terminal_failed / denom) * 100) / 100
    : 0;
  return { by_class, total_terminal_failed, total_terminal_done, failure_rate };
}

/**
 * 统一落库助手：把 result.failure_class + result.failure_detail 写进 tasks.result。
 * 「代码 ↔ tasks.result」的单一写入口（禁 mock 边：真 Postgres 验落库）。SQL 与既有
 * handoff.js / routes/execution.js 的 `result = COALESCE(result,'{}'::jsonb) || $::jsonb`
 * 惯用法逐字一致。失败前先 assertFailureClass（非法枚举直接 throw，不落库自由文本）。
 * @param {{query: Function}} dbPool
 * @param {string} taskId
 * @param {string} failureClass - ∈ FAILURE_CLASSES
 * @param {string|null} [failureDetail]
 * @returns {Promise<void>}
 */
export async function persistTerminalFailure(dbPool, taskId, failureClass, failureDetail = null) {
  const patch = buildFailureResultPatch(failureClass, failureDetail);
  await dbPool.query(
    `UPDATE tasks SET result = COALESCE(result, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
    [taskId, JSON.stringify(patch)],
  );
}
