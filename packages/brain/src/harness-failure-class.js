/**
 * harness-failure-class — harness terminal 失败观测地基（决策 e8f6134f 交付物2）。
 *
 * 背景：近 30 天 harness_initiative failed 六成 result 为 null——无法按根因收敛失败率，
 * 而「连续 7 天失败率 < 25%」是 /dev 入口 fail-closed 强制（交付物4）唯一的硬前置开锁闸。
 * 本模块提供三件套，统一所有 harness terminal 失败写入点：
 *   - FAILURE_CLASSES：受控枚举（Object.freeze），拒绝自由文本落库当 class。
 *   - normalizeFailureClass(x)：枚举成员原样返回，非枚举 / null / undefined → 'unclassified'。
 *   - markHarnessTaskTerminal(dbPool, taskId, {status, failureClass, failureDetail})：
 *       把 harness 任务打成 terminal 失败态，failure_class(规范化枚举)+failure_detail
 *       写进 tasks.result（与 status 同一 UPDATE 原子完成，杜绝「有 status 无 failure_class」半写）。
 *
 * 机械闸 packages/brain/scripts/lint/lint-terminal-failure-class.mjs 扫描裸写入点防回归。
 */

/**
 * FAILURE_CLASSES — 受控失败分类枚举（冻结）。
 *
 * 种子来源：全量扫描 packages/brain/src 现网已用 failure_class 取值 + 各 terminal 写入点分类。
 * 新增分类向后兼容（追加成员即可），删除成员需迁移。'unclassified' 是兜底桶：
 * 非枚举 / 自由文本 / 缺失一律归此，保证 terminal 失败永远留下受控 class，绝不落自由文本。
 */
export const FAILURE_CLASSES = Object.freeze([
  // ── 兜底 ──
  'unclassified',
  // ── harness router / executor 点火期硬校验 ──
  'missing_orchestrator_flag',
  'invalid_gear',
  'missing_gp_anchor',
  'missing_anchor',
  'max_fresh_starts_exceeded',
  // ── watchdog / 超时 / 断链终结 ──
  'watchdog_deadline',
  'relay_deadline_exceeded',
  'liveness_dead',
  // ── dispatcher / pipeline 终结 ──
  'pipeline_terminal_failure',
  'pre_flight_rejected',
  'dispatch_fail_autoblock',
  // ── 基础设施 / 隔离 ──
  'infrastructure_blocked',
  // ── 契约 / 能力 ──
  'contract_capability_mismatch',
  'contract_invalid',
  'env_skill_missing',
  // ── 证据 / 裁判 ──
  'evidence_insufficient',
  'evidence_invalid',
  // ── 产品 / 实现缺陷 ──
  'product_failure',
  'code_error',
  'runtime_crash',
  'runner_failure',
  'lint',
  'semantic_refusal',
  'no_diagnostic',
  // ── 供应商 / 配额 / 网络 ──
  'provider',
  'rate_limit',
  'billing_cap',
  'network',
  'timeout',
  'transient',
  'auth',
  'auth_failure',
  // ── 归类杂项 ──
  'needs_context',
  'repeated_failure',
  'systemic',
  'task_specific',
  'other',
  'unknown',
]);

const FAILURE_CLASS_SET = new Set(FAILURE_CLASSES);

/**
 * 允许写入 tasks 的 terminal 失败态集合（决策：三态 failed/blocked/cancelled）。
 * 冻结防篡改；helper 严格校验，非 terminal 状态直接抛错，绝不把 in_progress 写成假 terminal。
 */
export const TERMINAL_FAILURE_STATUSES = Object.freeze(['failed', 'blocked', 'cancelled']);
const TERMINAL_STATUS_SET = new Set(TERMINAL_FAILURE_STATUSES);

/**
 * normalizeFailureClass — 把任意输入规范化为受控枚举成员。
 *
 * 枚举成员 → 原样返回；自由文本 / null / undefined / 非字符串 → 'unclassified'。
 * 杜绝自由文本落库当 class（PRD 边界：非枚举 → 规范化到「未分类」，而非抛错留 null）。
 *
 * @param {*} x
 * @returns {string} 受控枚举成员
 */
export function normalizeFailureClass(x) {
  if (typeof x === 'string' && FAILURE_CLASS_SET.has(x)) return x;
  return 'unclassified';
}

/**
 * markHarnessTaskTerminal — 把一条 harness 任务打成 terminal 失败态并留根因。
 *
 * failure_class（规范化枚举）+ failure_detail（自由文本详情）写进 tasks.result，
 * 与 status 同一 UPDATE 原子完成。status 严格限定 terminal 三态，否则抛错。
 *
 * status 值经 TERMINAL_STATUS_SET 白名单校验后才拼进 SQL（非用户输入、无注入面），
 * 保留字面 `status = 'failed'` 形态供既有回归测试（harness-orchestrator-lockdown）识别。
 *
 * @param {{query: Function}} dbPool - pg Pool / Client（真库，禁 mock）
 * @param {string} taskId
 * @param {{status: string, failureClass?: string, failureDetail?: string|null}} opts
 * @returns {Promise<{taskId: string, status: string, failure_class: string, failure_detail: string|null}>}
 */
export async function markHarnessTaskTerminal(dbPool, taskId, opts = {}) {
  if (!dbPool || typeof dbPool.query !== 'function') {
    throw new Error('markHarnessTaskTerminal: dbPool.query 不可用');
  }
  if (!taskId) throw new Error('markHarnessTaskTerminal: taskId 必填');

  const { status, failureClass, failureDetail } = opts;
  if (!TERMINAL_STATUS_SET.has(status)) {
    throw new Error(
      `markHarnessTaskTerminal: status 必须是 terminal 之一（${TERMINAL_FAILURE_STATUSES.join('/')}），got: ${status}`
    );
  }

  const failure_class = normalizeFailureClass(failureClass);
  const failure_detail = failureDetail == null ? null : String(failureDetail).slice(0, 2000);
  const resultPatch = JSON.stringify({ failure_class, failure_detail });
  const errorMessage = failure_detail == null ? null : failure_detail.slice(0, 500);

  // status 已白名单校验，字面拼接安全；result 与 status 同一 UPDATE 原子写入。
  // 注：`UPDATE tasks SET status = '<status>'` 保持单行字面（既有回归测试
  // harness-orchestrator-lockdown 以 /UPDATE tasks SET[\s\S]*status\s*=\s*'failed'/ 匹配）。
  await dbPool.query(
    `UPDATE tasks SET status = '${status}', ` +
      `completed_at = COALESCE(completed_at, NOW()), ` +
      `error_message = COALESCE($2, error_message), ` +
      `result = COALESCE(result, '{}'::jsonb) || $3::jsonb, ` +
      `updated_at = NOW() ` +
      `WHERE id = $1`,
    [taskId, errorMessage, resultPatch]
  );

  return { taskId, status, failure_class, failure_detail };
}

export default { FAILURE_CLASSES, TERMINAL_FAILURE_STATUSES, normalizeFailureClass, markHarnessTaskTerminal };
