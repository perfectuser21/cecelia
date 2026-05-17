/**
 * Pipeline-Level Watchdog
 *
 * 与 pipeline-patrol（巡检单个 stage 超时）正交：
 * 本模块在 pipeline 级别监督（按 sprint_dir 聚合），
 * 当一个 harness pipeline 连续 N 小时（默认 6h）没有任何
 * 子任务状态变化时，判定为 pipeline_stuck：
 *   1. 将该 pipeline 所有 queued/in_progress/paused 任务 cancel
 *   2. 写入 cecelia_events (pipeline_stuck) 方便告警/观测
 *   3. 通过日志提示
 *
 * 恢复机制：stuck 判定基于 "max(updated_at) 距今 > 阈值"，
 * 所以只要手动 reset 该 pipeline 下任一任务的 updated_at（例如
 * 通过 API PATCH 任务状态）即可让 pipeline 重新进入活跃状态。
 *
 * 背景案例：sprint_dir harness-v5-e2e-test2 (planner d8acf398)
 * Evaluator→Fix 循环 47 轮无限 spin，跑 3 天没有 report。
 */

// 默认 6 小时无任何任务状态更新 → 判定 stuck
const DEFAULT_STUCK_THRESHOLD_HOURS = parseFloat(
  process.env.PIPELINE_STUCK_THRESHOLD_HOURS || '6'
);

// 仅对 harness_* pipeline 生效
const HARNESS_TASK_TYPES = [
  'harness_planner',
  'harness_contract_propose',
  'harness_contract_review',
  'harness_generate',
  'harness_fix',
  'harness_ci_watch',
  'harness_deploy_watch',
  'harness_evaluate',
  'harness_report',
];

/**
 * 扫描所有活跃 harness pipeline，返回 stuck 的 sprint_dir 列表
 *
 * 活跃定义：
 *  - sprint_dir IS NOT NULL
 *  - 该 sprint_dir 下不存在 status='completed' 的 harness_report 任务
 *    （即 pipeline 还没正常收尾）
 *  - 该 sprint_dir 至少有一个 queued/in_progress/paused 的任务
 *    （否则 pipeline 已经静止，用户可能已手动处理，不再报警）
 *
 * stuck 定义：max(updated_at) < NOW() - threshold
 *
 * @param {import('pg').Pool} pool
 * @param {{ thresholdHours?: number }} opts
 * @returns {Promise<{ scanned:number, stuck:number, pipelines: Array }>}
 */
export async function checkStuckPipelines(pool, opts = {}) {
  const thresholdHours = Number.isFinite(opts.thresholdHours)
    ? opts.thresholdHours
    : DEFAULT_STUCK_THRESHOLD_HOURS;

  const result = { scanned: 0, stuck: 0, pipelines: [] };

  // 1) 聚合：每个 sprint_dir 的 max(updated_at) / 统计 open task / 是否有 completed report
  const { rows: aggregates } = await pool.query(
    `
    SELECT
      sprint_dir,
      MAX(updated_at) AS last_update,
      COUNT(*) FILTER (WHERE status IN ('queued','in_progress','paused')) AS open_count,
      COUNT(*) FILTER (WHERE task_type = 'harness_report' AND status = 'completed') AS completed_reports,
      COUNT(*) AS total
    FROM tasks
    WHERE task_type = ANY($1)
      AND sprint_dir IS NOT NULL
      AND sprint_dir <> ''
    GROUP BY sprint_dir
    `,
    [HARNESS_TASK_TYPES]
  );

  result.scanned = aggregates.length;
  const nowMs = Date.now();
  const thresholdMs = thresholdHours * 60 * 60 * 1000;

  for (const row of aggregates) {
    // 已有 completed harness_report → pipeline 正常收尾，跳过
    if (parseInt(row.completed_reports, 10) > 0) continue;
    // 没有任何 open 任务 → pipeline 已静止（可能已 canceled/failed），跳过
    if (parseInt(row.open_count, 10) === 0) continue;

    const lastUpdateMs = row.last_update ? new Date(row.last_update).getTime() : 0;
    const idleMs = nowMs - lastUpdateMs;
    if (idleMs < thresholdMs) continue;

    const stuckForHours = idleMs / (60 * 60 * 1000);

    // 2) 找到 planner_task_id（从 payload，或该 sprint_dir 下最早的 harness_planner 任务）
    const { rows: plannerRows } = await pool.query(
      `
      SELECT id, payload
      FROM tasks
      WHERE sprint_dir = $1
      ORDER BY created_at ASC
      LIMIT 1
      `,
      [row.sprint_dir]
    );
    const plannerTaskId =
      plannerRows[0]?.payload?.planner_task_id || plannerRows[0]?.id || null;

    // 3) 取消所有 queued/in_progress/paused 任务
    const { rows: canceled } = await pool.query(
      `
      UPDATE tasks
         SET status = 'canceled',
             error_message = 'pipeline_stuck',
             completed_at = NOW()
       WHERE sprint_dir = $1
         AND task_type = ANY($2)
         AND status IN ('queued','in_progress','paused')
      RETURNING id
      `,
      [row.sprint_dir, HARNESS_TASK_TYPES]
    );

    // 4) 写事件
    await pool.query(
      `
      INSERT INTO cecelia_events (event_type, source, payload)
      VALUES ($1, $2, $3)
      `,
      [
        'pipeline_stuck',
        'pipeline-watchdog',
        JSON.stringify({
          sprint_dir: row.sprint_dir,
          planner_task_id: plannerTaskId,
          stuck_for_hours: Number(stuckForHours.toFixed(2)),
          threshold_hours: thresholdHours,
          canceled_task_ids: canceled.map((r) => r.id),
          last_update: row.last_update,
          total_tasks: parseInt(row.total, 10),
          timestamp: new Date().toISOString(),
        }),
      ]
    );

    console.warn(
      `[pipeline-watchdog] STUCK sprint_dir=${row.sprint_dir} planner=${plannerTaskId} idle=${stuckForHours.toFixed(1)}h canceled=${canceled.length}`
    );

    result.stuck++;
    result.pipelines.push({
      sprint_dir: row.sprint_dir,
      planner_task_id: plannerTaskId,
      stuck_for_hours: Number(stuckForHours.toFixed(2)),
      canceled_task_ids: canceled.map((r) => r.id),
    });
  }

  return result;
}

// 导出常量便于测试
export const _internals = {
  HARNESS_TASK_TYPES,
  DEFAULT_STUCK_THRESHOLD_HOURS,
};
