/**
 * kernel run "排队/回队"识别 —— 成功率统计口径收口。
 *
 * 背景：跑场机编排槽满（bridge 429 orchestrator_slots_exhausted）等瞬时故障时，
 * requeueKernelRunLaunchDeferred 把 run 置 phase='failed'（清理触发器依赖 phase IN ('done','failed')，
 * 不能改），父任务回 queued 等下个 tick 重建新 run。这类 run 不是真实失败，
 * 但直接 COUNT 会把成功率稀释（实证：近 60 天 275 条，单任务 227 条）。
 * 统计处统一用本模块把它们从 runs/done/failed/last_failure 里剔掉，单列 deferred。
 */

/** harness-skill-relay：远程点火撞 429/5xx/超时，run 记失败、任务回队。 */
export const KERNEL_LAUNCH_DEFERRED_REASON_PREFIX = 'kernel_remote_launch_deferred:';
/** harness-relay-watchdog：reconcile 无可恢复会话，run 记失败、任务回队远端重派。 */
export const KERNEL_RECONCILE_REQUEUE_REASON_PREFIX = 'kernel_reconcile_remote_requeue:';
/** 延后次数用尽后调用方追加的后缀：此时是真实终态失败，不算排队。 */
export const KERNEL_REQUEUE_EXHAUSTED_SUFFIX = ':defers_exhausted';

const DEFERRED_PREFIXES = [
  KERNEL_LAUNCH_DEFERRED_REASON_PREFIX,
  KERNEL_RECONCILE_REQUEUE_REASON_PREFIX,
];

/** failure_reason 是否属于"排队回队"（非真实失败）。 */
export function isLaunchDeferredReason(reason) {
  if (typeof reason !== 'string' || reason === '') return false;
  if (reason.endsWith(KERNEL_REQUEUE_EXHAUSTED_SUFFIX)) return false;
  return DEFERRED_PREFIXES.some((p) => reason.startsWith(p));
}

/**
 * SQL 布尔片段：<alias> 行是排队 run。恒为非 NULL 布尔，可放心 `NOT (...)`。
 * 用 starts_with 而非 LIKE：前缀里的 `_` 是 LIKE 通配符。常量不含引号，可直接内联。
 */
export function launchDeferredSql(alias = 'ir') {
  const col = `${alias}.failure_reason`;
  const prefixes = DEFERRED_PREFIXES.map((p) => `starts_with(${col}, '${p}')`).join(' OR ');
  return `(${col} IS NOT NULL AND (${prefixes})`
    + ` AND right(${col}, ${KERNEL_REQUEUE_EXHAUSTED_SUFFIX.length}) <> '${KERNEL_REQUEUE_EXHAUSTED_SUFFIX}')`;
}

/**
 * 按 journey 聚合 initiative_runs 的 SELECT 列清单（含 j.id/j.name，不含 FROM）。
 * runs/done/failed/last_failure 只统计非排队 run，deferred = 排队 run 数。
 * routes/harness.js ?by=journey 与 battle-report.js 共用。
 */
export function journeyRunStatsSelectSql(alias = 'ir') {
  const d = launchDeferredSql(alias);
  return `j.id   AS journey_id,
            j.name AS journey_name,
            COUNT(*) FILTER (WHERE NOT ${d}) AS runs,
            COUNT(*) FILTER (WHERE ${alias}.phase = 'done' AND NOT ${d}) AS done,
            COUNT(*) FILTER (WHERE ${alias}.phase = 'failed' AND NOT ${d}) AS failed,
            COUNT(*) FILTER (WHERE ${d}) AS deferred,
            MAX(${alias}.created_at) AS last_run_at,
            (ARRAY_AGG(${alias}.failure_reason ORDER BY ${alias}.created_at DESC)
               FILTER (WHERE ${alias}.failure_reason IS NOT NULL AND NOT ${d}))[1] AS last_failure`;
}

/** 聚合行 → 响应对象。成功率 = done/(done+failed)，只算终态 run，排队与进行中不进分母。 */
export function mapJourneyRunStatsRow(r) {
  const done = parseInt(r.done, 10) || 0;
  const failed = parseInt(r.failed, 10) || 0;
  const terminal = done + failed;
  return {
    journey_id: r.journey_id,
    journey_name: r.journey_name,
    runs: parseInt(r.runs, 10) || 0,
    done,
    failed,
    deferred: parseInt(r.deferred, 10) || 0,
    success_rate: terminal > 0 ? Math.round((done / terminal) * 100) / 100 : 0,
    last_run_at: r.last_run_at,
    last_failure: r.last_failure || null,
  };
}
