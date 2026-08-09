/**
 * harness-failure-class.js — harness terminal 失败原因标准化写入 tasks.result 列。
 *
 * 背景：近30天 harness_initiative failed 274 条中 241 条 result=null，六成失败连原因
 * 都没写。根因：terminal 写入点从未写 result 列（failure_class 散落 custom_props/payload
 * 或完全缺失）。本模块提供单一 fail-closed 共享 helper 收口——所有 harness terminal 写
 * 经 markHarnessTerminal 强制写 result.failure_class（冻结枚举）+ result.failure_detail。
 *
 * fail-closed：failureClass 非白名单枚举 → assertFailureClass 抛错，UPDATE 绝不执行，
 * 宁拦不放（绝不落库 null failure_class）。
 */

/**
 * 冻结枚举 —— failure_class 的 ground truth 白名单（取值来自真实失败样本 + 现有代码常量）。
 * `unknown` 是唯一兜底/历史 null 桶；写入点禁止主动写未登记字符串。
 */
export const FAILURE_CLASSES = Object.freeze([
  'max_fresh_starts_exceeded',
  'invalid_gear',
  'pipeline_terminal_failure',
  'missing_anchor',
  'dispatch_exception',
  'dispatch_fail_autoblock',
  'pre_flight_rejected',
  'relay_deadline_exceeded',
  'codex_config_error',
  'auth_failure',
  'contract_superseded',
  'duplicate_merged',
  'watchdog_deadline',
  'infrastructure_blocked',
  'evidence_invalid',
  'product_failure',
  'unknown',
]);

const _FAILURE_CLASS_SET = new Set(FAILURE_CLASSES);

/** harness 任务的 terminal 状态集合。 */
export const TERMINAL_STATUSES = Object.freeze(['failed', 'blocked', 'cancelled']);

/**
 * assertFailureClass — 白名单外值一律抛错（fail-closed）。
 * @param {string} fc
 * @returns {string} fc（合法时原样返回）
 */
export function assertFailureClass(fc) {
  if (typeof fc !== 'string' || fc.length === 0 || !_FAILURE_CLASS_SET.has(fc)) {
    throw new Error(
      `invalid failure_class: ${JSON.stringify(fc)} — must be one of [${FAILURE_CLASSES.join(', ')}]`,
    );
  }
  return fc;
}

/**
 * markHarnessTerminal — 把 harness 任务打成 terminal 状态并强制写 result.failure_class。
 *
 * 校验 status ∈ TERMINAL_STATUSES 且 failureClass ∈ FAILURE_CLASSES（fail-closed，
 * 任一不合法直接抛错，UPDATE 绝不执行）。写入时同写 completed_at（COALESCE 保留首次），
 * 保证 failure-stats 的窗口基准列可靠。
 *
 * @param {{query: Function}} pool - pg Pool / Client（真 Postgres，不 mock 此写边）
 * @param {{taskId: string, status: string, failureClass: string, failureDetail?: string|null}} args
 * @returns {Promise<{rowCount: number}>}
 */
export async function markHarnessTerminal(pool, { taskId, status, failureClass, failureDetail = null } = {}) {
  if (!taskId) throw new Error('markHarnessTerminal: taskId required');
  if (!TERMINAL_STATUSES.includes(status)) {
    throw new Error(
      `markHarnessTerminal: status must be terminal (${TERMINAL_STATUSES.join('|')}), got ${JSON.stringify(status)}`,
    );
  }
  // fail-closed：非法枚举在任何 DB 写之前抛出。
  assertFailureClass(failureClass);

  const detail = failureDetail == null ? null : String(failureDetail).slice(0, 2000);
  const { rowCount } = await pool.query(
    `UPDATE tasks
        SET status        = $2,
            error_message = COALESCE($4, error_message),
            completed_at  = COALESCE(completed_at, NOW()),
            updated_at    = NOW(),
            result        = COALESCE(result, '{}'::jsonb)
                            || jsonb_build_object('failure_class', $3::text, 'failure_detail', $4::text)
      WHERE id = $1`,
    [taskId, status, failureClass, detail],
  );
  return { rowCount };
}
