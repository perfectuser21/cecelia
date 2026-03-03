/**
 * System Report Scheduler - 48h 系统简报定时调度器
 *
 * 职责：
 * - 查询 system_reports 表，获取上次生成时间
 * - 判断是否超过 48h
 * - 触发 cortex.generateSystemReport()
 *
 * 被 tick.js 的 executeTick() 调用（每次 tick 执行一次检查）
 */

/* global console */

const REPORT_INTERVAL_HOURS = 48;
const REPORT_INTERVAL_MS = REPORT_INTERVAL_HOURS * 60 * 60 * 1000;

/**
 * 查询 system_reports 表最后一次简报的生成时间
 * @param {Object} pool - PostgreSQL 连接池
 * @param {string} reportType - 简报类型（默认 system_48h）
 * @returns {Promise<Date|null>} 最后生成时间，或 null（首次运行）
 */
async function getLastReportTime(pool, reportType = 'system_48h') {
  const result = await pool.query(`
    SELECT generated_at
    FROM system_reports
    WHERE report_type = $1
    ORDER BY generated_at DESC
    LIMIT 1
  `, [reportType]);

  if (result.rows.length === 0) {
    return null;
  }

  return new Date(result.rows[0].generated_at);
}

/**
 * 检查是否需要生成系统简报，如需要则触发生成
 *
 * @param {Object} pool - PostgreSQL 连接池
 * @param {string} [reportType] - 简报类型（默认 system_48h）
 * @returns {Promise<{
 *   triggered: boolean,
 *   success?: boolean,
 *   reportId?: string,
 *   error?: string,
 *   hoursElapsed?: number,
 *   reason?: string
 * }>}
 */
async function checkAndGenerateSystemReport(pool, reportType = 'system_48h') {
  const now = Date.now();

  let lastReportTime;
  try {
    lastReportTime = await getLastReportTime(pool, reportType);
  } catch (err) {
    console.error('[tick:48h-report] 查询上次简报时间失败:', err.message);
    return {
      triggered: false,
      reason: `查询失败: ${err.message}`
    };
  }

  // 首次运行或超过 48h 则触发
  let hoursElapsed = null;
  let shouldGenerate = false;

  if (lastReportTime === null) {
    // 首次运行，没有历史记录
    shouldGenerate = true;
    console.log('[tick:48h-report] 首次运行，开始生成系统简报');
  } else {
    const elapsedMs = now - lastReportTime.getTime();
    hoursElapsed = elapsedMs / (60 * 60 * 1000);

    if (elapsedMs >= REPORT_INTERVAL_MS) {
      shouldGenerate = true;
      console.log(`[tick:48h-report] 距上次简报已过 ${hoursElapsed.toFixed(1)}h，触发生成`);
    }
  }

  if (!shouldGenerate) {
    return {
      triggered: false,
      hoursElapsed
    };
  }

  // 触发简报生成
  try {
    const { generateSystemReport } = await import('./cortex.js');
    const result = await generateSystemReport();

    return {
      triggered: true,
      success: result.success,
      reportId: result.reportId,
      error: result.error,
      hoursElapsed
    };
  } catch (err) {
    console.error('[tick:48h-report] 调用 generateSystemReport 失败:', err.message);
    return {
      triggered: true,
      success: false,
      error: `调用失败: ${err.message}`,
      hoursElapsed
    };
  }
}

export {
  checkAndGenerateSystemReport,
  getLastReportTime,
  REPORT_INTERVAL_HOURS,
  REPORT_INTERVAL_MS
};
