/**
 * 48h 系统简报模块
 *
 * 从 tick.js 抽出（Brain v2 Phase D Part 1.1）。
 * 仅依赖传入的 dbPool，零 module-state 与 tick 主循环耦合。
 */

// 本地 tickLog（带 [report-48h] 自标识，与 tick.js 实现一致）
const _write = console.log;
function tickLog(...args) {
  const ts = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  _write(`[${ts}][report-48h]`, ...args);
}

let _lastReportTime = 0; // track last 48h system report generation time

const REPORT_INTERVAL_MS = parseInt(process.env.CECELIA_REPORT_INTERVAL_MS || String(48 * 60 * 60 * 1000), 10); // 48 hours

/**
 * 生成 48h 系统简报内容（mock cortex 调用）
 * 查询近 48h 任务统计和系统健康状况，组装简报 JSON
 * @param {Pool} dbPool - PostgreSQL 连接池
 * @returns {Object} 简报内容对象
 */
async function generate48hReport(dbPool) {
  const periodHours = 48;
  const since = new Date(Date.now() - periodHours * 60 * 60 * 1000).toISOString();

  // 查询近 48h 任务统计
  const taskStats = await dbPool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'completed') AS completed,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed,
      COUNT(*) FILTER (WHERE status = 'queued') AS queued,
      COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
      COUNT(*) FILTER (WHERE status = 'quarantined') AS quarantined,
      COUNT(*) AS total
    FROM tasks
    WHERE created_at >= $1
  `, [since]);

  // 查询近 48h 告警事件（P0/P1）
  const alertStats = await dbPool.query(`
    SELECT event_type, COUNT(*) AS count
    FROM cecelia_events
    WHERE created_at >= $1
      AND event_type IN ('p0_alert', 'p1_alert', 'task_failed', 'quarantine_triggered', 'circuit_breaker_open')
    GROUP BY event_type
    ORDER BY count DESC
    LIMIT 10
  `, [since]);

  // 查询隔离区统计
  const quarantineStats = await dbPool.query(`
    SELECT COUNT(*) AS count
    FROM tasks
    WHERE status = 'quarantined'
  `);

  // 组装简报内容
  const stats = taskStats.rows[0] || {};
  const completed = parseInt(stats.completed || 0, 10);
  const failed = parseInt(stats.failed || 0, 10);
  const total = parseInt(stats.total || 0, 10);
  const successRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  const alertEvents = alertStats.rows || [];
  const hasAlerts = alertEvents.length > 0;

  // 简单健康评分（mock 逻辑，可后续替换为真实 cortex 分析）
  let healthScore = 100;
  if (failed > 5) healthScore -= 20;
  if (successRate < 70) healthScore -= 20;
  if (hasAlerts) healthScore -= alertEvents.reduce((acc, e) => acc + parseInt(e.count, 10), 0) * 2;
  healthScore = Math.max(0, Math.min(100, healthScore));

  const healthStatus = healthScore >= 80 ? 'healthy' : healthScore >= 60 ? 'degraded' : 'critical';

  return {
    period_hours: periodHours,
    period_start: since,
    period_end: new Date().toISOString(),
    tasks_summary: {
      total: parseInt(stats.total || 0, 10),
      completed: parseInt(stats.completed || 0, 10),
      failed: parseInt(stats.failed || 0, 10),
      queued: parseInt(stats.queued || 0, 10),
      in_progress: parseInt(stats.in_progress || 0, 10),
      quarantined: parseInt(stats.quarantined || 0, 10),
      success_rate_percent: successRate
    },
    system_health: {
      score: healthScore,
      status: healthStatus,
      quarantine_total: parseInt(quarantineStats.rows[0]?.count || 0, 10)
    },
    alert_events: alertEvents.map(e => ({ type: e.event_type, count: parseInt(e.count, 10) })),
    generated_by: 'mock_cortex', // TODO: 后续替换为真实 cortex 调用
    notes: `过去 ${periodHours} 小时系统自动摘要（mock 版本）`
  };
}

/**
 * 检查是否需要生成 48h 简报，如需要则调用 cortex.generateSystemReport() 生成
 * 检查时间间隔（REPORT_INTERVAL_MS，默认 48h），满足条件则触发生成
 * @param {Pool} dbPool - PostgreSQL 连接池（接口兼容性保留，cortex 使用自己的 pool）
 * @param {Object} options - 选项
 * @param {boolean} [options.force=false] - 强制触发（忽略时间检查）
 * @returns {Object|null} 生成的简报记录（含 id, created_at），或 null（未触发）
 */
async function check48hReport(dbPool, { force = false } = {}) {
  const elapsed = Date.now() - _lastReportTime;
  if (!force && elapsed < REPORT_INTERVAL_MS) {
    return null; // 未到触发时间
  }

  _lastReportTime = Date.now();
  tickLog(`[tick] 触发 48h 系统简报生成（elapsed: ${Math.round(elapsed / 3600000)}h, force: ${force}）`);

  try {
    // 调用 cortex.generateSystemReport() 生成真实 AI 简报（含 LLM 深度分析）
    // cortex 内部使用自己的 pool 实例，并负责写入 system_reports 表
    const { generateSystemReport } = await import('./cortex.js');
    const report = await generateSystemReport({ timeRangeHours: 48 });

    if (!report || !report.id) {
      throw new Error('cortex.generateSystemReport 返回无效结果');
    }

    tickLog(`[tick] 48h 简报已生成（by cortex），id: ${report.id}`);
    return { id: report.id, created_at: report.generated_at };
  } catch (err) {
    console.error('[tick] 48h 简报生成失败（non-critical）:', err.message);
    _lastReportTime = 0; // 重置时间，允许下次 tick 重试
    return null;
  }
}

export { generate48hReport, check48hReport, REPORT_INTERVAL_MS };
