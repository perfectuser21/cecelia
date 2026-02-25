/**
 * Layer 2 运行健康监控
 *
 * 每小时在 tick 中触发一次，纯 SQL 查运行数据，对比阈值。
 * 结果写入 cecelia_events 表（type='layer2_health'）。
 * 不需要 LLM，纯代码逻辑。
 *
 * 检查项：
 *   dispatched_1h        - 过去1小时完成的任务数
 *   stuck_tasks          - in_progress 超过 2 小时的任务数
 *   last_success_ago_min - 距上次成功完成任务的分钟数
 *   queue_depth          - 当前 queued 任务数
 *
 * 健康等级：
 *   healthy  - 所有检查通过
 *   warning  - 1-2 项异常
 *   critical - 3+ 项异常 或 stuck_tasks > 10
 */

// Thresholds
const THRESHOLDS = {
  dispatched_1h: { warning_below: 1, system_min_uptime_h: 3 },
  stuck_tasks: { warning_above: 3, critical_above: 10 },
  last_success_ago_min: { warning_above: 360 },
  queue_depth: { warning_above: 50 },
};

/**
 * Run all 4 SQL health checks.
 * @param {import('pg').Pool} pool
 * @returns {Promise<Object>} - { checks, level, summary }
 */
async function runLayer2HealthCheck(pool) {
  const checks = {};

  // Check 1: dispatched_1h — tasks completed in the last 1 hour
  try {
    const r1 = await pool.query(`
      SELECT COUNT(*) AS cnt
      FROM tasks
      WHERE status = 'completed'
        AND updated_at >= NOW() - INTERVAL '1 hour'
    `);
    const dispatched_1h = parseInt(r1.rows[0]?.cnt ?? 0, 10);

    // Only warn if system has been running long enough
    const r1uptime = await pool.query(`
      SELECT EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) / 3600 AS uptime_h
      FROM tasks
    `);
    const uptime_h = parseFloat(r1uptime.rows[0]?.uptime_h ?? 0);
    const min_uptime = THRESHOLDS.dispatched_1h.system_min_uptime_h;
    const warn = dispatched_1h < THRESHOLDS.dispatched_1h.warning_below && uptime_h >= min_uptime;

    checks.dispatched_1h = { value: dispatched_1h, uptime_h: Math.round(uptime_h * 10) / 10, ok: !warn };
  } catch (err) {
    checks.dispatched_1h = { error: err.message, ok: true }; // non-blocking
  }

  // Check 2: stuck_tasks — in_progress > 2 hours
  try {
    const r2 = await pool.query(`
      SELECT COUNT(*) AS cnt
      FROM tasks
      WHERE status = 'in_progress'
        AND updated_at < NOW() - INTERVAL '2 hours'
    `);
    const stuck_tasks = parseInt(r2.rows[0]?.cnt ?? 0, 10);
    const ok = stuck_tasks <= THRESHOLDS.stuck_tasks.warning_above;

    checks.stuck_tasks = { value: stuck_tasks, ok };
  } catch (err) {
    checks.stuck_tasks = { error: err.message, ok: true };
  }

  // Check 3: last_success_ago_min — minutes since last completed task
  try {
    const r3 = await pool.query(`
      SELECT EXTRACT(EPOCH FROM (NOW() - MAX(updated_at))) / 60 AS ago_min
      FROM tasks
      WHERE status = 'completed'
    `);
    const ago_min = r3.rows[0]?.ago_min != null
      ? Math.round(parseFloat(r3.rows[0].ago_min))
      : null;
    const ok = ago_min === null || ago_min <= THRESHOLDS.last_success_ago_min.warning_above;

    checks.last_success_ago_min = { value: ago_min, ok };
  } catch (err) {
    checks.last_success_ago_min = { error: err.message, ok: true };
  }

  // Check 4: queue_depth — current queued tasks
  try {
    const r4 = await pool.query(`
      SELECT COUNT(*) AS cnt
      FROM tasks
      WHERE status = 'queued'
    `);
    const queue_depth = parseInt(r4.rows[0]?.cnt ?? 0, 10);
    const ok = queue_depth <= THRESHOLDS.queue_depth.warning_above;

    checks.queue_depth = { value: queue_depth, ok };
  } catch (err) {
    checks.queue_depth = { error: err.message, ok: true };
  }

  const level = calculateHealthLevel(checks);
  const failing = Object.entries(checks)
    .filter(([, v]) => !v.ok)
    .map(([k]) => k);

  const result = {
    level,
    checks,
    failing,
    summary: `Layer2Health: ${level} (${failing.length} issues: ${failing.join(', ') || 'none'})`,
    checked_at: new Date().toISOString(),
  };

  try {
    await recordHealthEvent(pool, result);
  } catch (recErr) {
    console.error('[health-monitor] Failed to record health event (non-fatal):', recErr.message);
  }
  return result;
}

/**
 * Calculate health level based on check results.
 * @param {Object} checks - { dispatched_1h, stuck_tasks, last_success_ago_min, queue_depth }
 * @returns {'healthy' | 'warning' | 'critical'}
 */
function calculateHealthLevel(checks) {
  const stuck = checks.stuck_tasks?.value ?? 0;
  const failCount = Object.values(checks).filter(v => !v.ok).length;

  if (stuck > THRESHOLDS.stuck_tasks.critical_above || failCount >= 3) {
    return 'critical';
  }
  if (failCount >= 1) {
    return 'warning';
  }
  return 'healthy';
}

/**
 * Write health check result to cecelia_events table.
 * @param {import('pg').Pool} pool
 * @param {Object} result - from runLayer2HealthCheck
 */
async function recordHealthEvent(pool, result) {
  await pool.query(
    `INSERT INTO cecelia_events (event_type, source, payload)
     VALUES ('layer2_health', 'brain_health_monitor', $1)`,
    [JSON.stringify(result)]
  );
}

export {
  runLayer2HealthCheck,
  calculateHealthLevel,
  recordHealthEvent,
  THRESHOLDS,
};
