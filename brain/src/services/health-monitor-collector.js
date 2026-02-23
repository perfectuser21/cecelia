/**
 * 瓶颈扫描结果收集器
 *
 * 收集系统瓶颈扫描结果并存储到 bottleneck_scans 表。
 * 扫描类型包括：
 *   - system_performance: 系统性能扫描
 *   - queue_depth: 队列深度扫描
 *   - task_stuck: 任务卡住扫描
 *   - resource_usage: 资源使用扫描
 *
 * 遵循 health-monitor.js 的模式，纯 SQL 查询。
 */

import pool from '../db.js';

/**
 * 扫描类型枚举
 */
export const SCAN_TYPES = {
  SYSTEM_PERFORMANCE: 'system_performance',
  QUEUE_DEPTH: 'queue_depth',
  TASK_STUCK: 'task_stuck',
  RESOURCE_USAGE: 'resource_usage',
  DB_CONNECTIONS: 'db_connections',
  TASK_TYPE_FAILURE: 'task_type_failure',
  SESSION_TIMEOUT: 'session_timeout',
};

/**
 * 严重程度枚举
 */
export const SEVERITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
};

/**
 * 执行瓶颈扫描并记录结果
 * @param {import('pg').Pool} pool - 数据库连接池
 * @param {string} scanType - 扫描类型
 * @returns {Promise<Object>} - 扫描结果
 */
async function runBottleneckScan(pool, scanType) {
  let scanResult;

  switch (scanType) {
    case SCAN_TYPES.SYSTEM_PERFORMANCE:
      scanResult = await scanSystemPerformance(pool);
      break;
    case SCAN_TYPES.QUEUE_DEPTH:
      scanResult = await scanQueueDepth(pool);
      break;
    case SCAN_TYPES.TASK_STUCK:
      scanResult = await scanTaskStuck(pool);
      break;
    case SCAN_TYPES.RESOURCE_USAGE:
      scanResult = await scanResourceUsage(pool);
      break;
    case SCAN_TYPES.DB_CONNECTIONS:
      scanResult = await scanDbConnections(pool);
      break;
    case SCAN_TYPES.TASK_TYPE_FAILURE:
      scanResult = await scanTaskTypeFailure(pool);
      break;
    case SCAN_TYPES.SESSION_TIMEOUT:
      scanResult = await scanSessionTimeout(pool);
      break;
    default:
      scanResult = {
        bottleneck_area: 'unknown',
        severity: SEVERITY.MEDIUM,
        details: { error: `Unknown scan type: ${scanType}` },
        recommendations: [],
      };
  }

  // 存储到数据库
  await recordBottleneckScan(pool, scanType, scanResult);

  return {
    scan_type: scanType,
    ...scanResult,
    scanned_at: new Date().toISOString(),
  };
}

/**
 * 系统性能扫描
 * @param {import('pg').Pool} pool
 * @returns {Promise<Object>}
 */
async function scanSystemPerformance(pool) {
  // 检查平均任务执行时间
  const execTimeResult = await pool.query(`
    SELECT
      AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) / 60 AS avg_duration_min,
      COUNT(*) AS total_tasks
    FROM tasks
    WHERE status = 'completed'
      AND updated_at >= NOW() - INTERVAL '24 hours'
  `);

  const avgDurationMin = parseFloat(execTimeResult.rows[0]?.avg_duration_min ?? 0);
  const totalTasks = parseInt(execTimeResult.rows[0]?.total_tasks ?? 0, 10);

  // 判断严重程度
  let severity = SEVERITY.LOW;
  let bottleneckArea = 'system_performance';
  const recommendations = [];

  if (avgDurationMin > 60) {
    severity = SEVERITY.CRITICAL;
    recommendations.push('任务平均执行时间过长，建议检查 executor 资源');
  } else if (avgDurationMin > 30) {
    severity = SEVERITY.HIGH;
    recommendations.push('任务执行时间偏高，建议关注');
  } else if (avgDurationMin > 15) {
    severity = SEVERITY.MEDIUM;
    recommendations.push('任务执行时间一般，继续监控');
  }

  if (totalTasks < 10 && avgDurationMin > 5) {
    severity = Math.max(severity, SEVERITY.MEDIUM);
    recommendations.push('任务量较少但执行时间长，可能存在瓶颈');
  }

  return {
    bottleneck_area: bottleneckArea,
    severity,
    details: {
      avg_duration_min: Math.round(avgDurationMin * 10) / 10,
      total_tasks_24h: totalTasks,
    },
    recommendations,
  };
}

/**
 * 队列深度扫描
 * @param {import('pg').Pool} pool
 * @returns {Promise<Object>}
 */
async function scanQueueDepth(pool) {
  // 检查排队任务数
  const queueResult = await pool.query(`
    SELECT COUNT(*) AS queued_count
    FROM tasks
    WHERE status = 'queued'
  `);

  const queuedCount = parseInt(queueResult.rows[0]?.queued_count ?? 0, 10);

  // 检查排队超过 30 分钟的任务
  const staleQueueResult = await pool.query(`
    SELECT COUNT(*) AS stale_count
    FROM tasks
    WHERE status = 'queued'
      AND created_at < NOW() - INTERVAL '30 minutes'
  `);

  const staleCount = parseInt(staleQueueResult.rows[0]?.stale_count ?? 0, 10);

  // 判断严重程度
  let severity = SEVERITY.LOW;
  let bottleneckArea = 'queue_depth';
  const recommendations = [];

  if (queuedCount > 100 || staleCount > 20) {
    severity = SEVERITY.CRITICAL;
    recommendations.push('队列堆积严重，需要立即处理');
  } else if (queuedCount > 50 || staleCount > 10) {
    severity = SEVERITY.HIGH;
    recommendations.push('队列深度较高，建议检查调度');
  } else if (queuedCount > 20 || staleCount > 5) {
    severity = SEVERITY.MEDIUM;
    recommendations.push('队列有积压趋势');
  }

  if (severity === SEVERITY.LOW && queuedCount > 0) {
    recommendations.push('队列正常，继续监控');
  }

  return {
    bottleneck_area: bottleneckArea,
    severity,
    details: {
      queued_count: queuedCount,
      stale_count: staleCount,
    },
    recommendations,
  };
}

/**
 * 任务卡住扫描
 * @param {import('pg').Pool} pool
 * @returns {Promise<Object>}
 */
async function scanTaskStuck(pool) {
  // 检查 in_progress 超过 2 小时的任务
  const stuckResult = await pool.query(`
    SELECT
      COUNT(*) AS stuck_count,
      ARRAY_AGG(id) AS stuck_ids
    FROM tasks
    WHERE status = 'in_progress'
      AND updated_at < NOW() - INTERVAL '2 hours'
  `);

  const stuckCount = parseInt(stuckResult.rows[0]?.stuck_count ?? 0, 10);
  const stuckIds = stuckResult.rows[0]?.stuck_ids ?? [];

  // 检查 in_progress 超过 4 小时的任务（严重卡住）
  const criticalStuckResult = await pool.query(`
    SELECT COUNT(*) AS critical_count
    FROM tasks
    WHERE status = 'in_progress'
      AND updated_at < NOW() - INTERVAL '4 hours'
  `);

  const criticalCount = parseInt(criticalStuckResult.rows[0]?.critical_count ?? 0, 10);

  // 判断严重程度
  let severity = SEVERITY.LOW;
  let bottleneckArea = 'task_stuck';
  const recommendations = [];

  if (criticalCount > 0) {
    severity = SEVERITY.CRITICAL;
    recommendations.push(`${criticalCount} 个任务卡住超过 4 小时，需要强制重试或隔离`);
  } else if (stuckCount > 10) {
    severity = SEVERITY.HIGH;
    recommendations.push('大量任务卡住，建议检查 executor 状态');
  } else if (stuckCount > 3) {
    severity = SEVERITY.MEDIUM;
    recommendations.push('有任务卡住，建议关注');
  }

  if (severity === SEVERITY.LOW && stuckCount === 0) {
    recommendations.push('没有卡住的任务，系统运行正常');
  }

  return {
    bottleneck_area: bottleneckArea,
    severity,
    details: {
      stuck_count: stuckCount,
      critical_count: criticalCount,
      stuck_task_ids: stuckIds.slice(0, 10), // 最多记录 10 个
    },
    recommendations,
  };
}

/**
 * 资源使用扫描
 * @param {import('pg').Pool} pool
 * @returns {Promise<Object>}
 */
async function scanResourceUsage(pool) {
  // 检查活跃进程数
  const activeProcessResult = await pool.query(`
    SELECT COUNT(*) AS active_count
    FROM task_runs
    WHERE status = 'running'
      AND started_at > NOW() - INTERVAL '10 minutes'
  `);

  const activeCount = parseInt(activeProcessResult.rows[0]?.active_count ?? 0, 10);

  // 检查失败的 task_runs（过去 1 小时）
  const failedRunsResult = await pool.query(`
    SELECT COUNT(*) AS failed_count
    FROM task_runs
    WHERE status = 'failed'
      AND ended_at >= NOW() - INTERVAL '1 hour'
  `);

  const failedCount = parseInt(failedRunsResult.rows[0]?.failed_count ?? 0, 10);

  // 检查总 task_runs（过去 1 小时）
  const totalRunsResult = await pool.query(`
    SELECT COUNT(*) AS total_count
    FROM task_runs
    WHERE ended_at >= NOW() - INTERVAL '1 hour'
  `);

  const totalCount = parseInt(totalRunsResult.rows[0]?.total_count ?? 0, 10);

  const failureRate = totalCount > 0 ? (failedCount / totalCount) * 100 : 0;

  // 判断严重程度
  let severity = SEVERITY.LOW;
  let bottleneckArea = 'resource_usage';
  const recommendations = [];

  if (failureRate > 50 || failedCount > 20) {
    severity = SEVERITY.CRITICAL;
    recommendations.push(`失败率过高 (${failureRate.toFixed(1)}%)，需要立即排查`);
  } else if (failureRate > 20 || failedCount > 10) {
    severity = SEVERITY.HIGH;
    recommendations.push(`失败率偏高 (${failureRate.toFixed(1)}%)，建议检查资源`);
  } else if (failureRate > 10 || failedCount > 5) {
    severity = SEVERITY.MEDIUM;
    recommendations.push(`存在一定失败率 (${failureRate.toFixed(1)}%)`);
  }

  if (activeCount > 20) {
    severity = Math.max(severity, SEVERITY.HIGH);
    recommendations.push('活跃进程数较高，建议检查并发限制');
  }

  if (severity === SEVERITY.LOW) {
    recommendations.push('资源使用正常');
  }

  return {
    bottleneck_area: bottleneckArea,
    severity,
    details: {
      active_processes: activeCount,
      failed_runs_1h: failedCount,
      total_runs_1h: totalCount,
      failure_rate_percent: Math.round(failureRate * 10) / 10,
    },
    recommendations,
  };
}

/**
 * 数据库连接扫描
 * @param {import('pg').Pool} pool
 * @returns {Promise<Object>}
 */
async function scanDbConnections(pool) {
  // 检查 PostgreSQL 活跃连接数
  const activeConnResult = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE state = 'active') AS active_count,
      COUNT(*) FILTER (WHERE state = 'idle') AS idle_count,
      COUNT(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_transaction_count,
      COUNT(*) AS total_count
    FROM pg_stat_activity
    WHERE datname = current_database()
  `);

  const activeCount = parseInt(activeConnResult.rows[0]?.active_count ?? 0, 10);
  const idleCount = parseInt(activeConnResult.rows[0]?.idle_count ?? 0, 10);
  const idleInTransCount = parseInt(activeConnResult.rows[0]?.idle_in_transaction_count ?? 0, 10);
  const totalCount = parseInt(activeConnResult.rows[0]?.total_count ?? 0, 10);

  // 检查长时间运行的查询（超过 30 秒）
  const longQueryResult = await pool.query(`
    SELECT COUNT(*) AS long_query_count
    FROM pg_stat_activity
    WHERE state = 'active'
      AND query_start < NOW() - INTERVAL '30 seconds'
      AND datname = current_database()
  `);

  const longQueryCount = parseInt(longQueryResult.rows[0]?.long_query_count ?? 0, 10);

  // 检查 idle 连接超过 30 分钟的
  const staleIdleResult = await pool.query(`
    SELECT COUNT(*) AS stale_idle_count
    FROM pg_stat_activity
    WHERE state = 'idle'
      AND state_change < NOW() - INTERVAL '30 minutes'
      AND datname = current_database()
  `);

  const staleIdleCount = parseInt(staleIdleResult.rows[0]?.stale_idle_count ?? 0, 10);

  // 判断严重程度
  let severity = SEVERITY.LOW;
  let bottleneckArea = 'db_connections';
  const recommendations = [];

  // PostgreSQL 默认 max_connections 是 100
  const connectionUsagePercent = (totalCount / 100) * 100;

  if (connectionUsagePercent > 90 || activeCount > 80) {
    severity = SEVERITY.CRITICAL;
    recommendations.push(`数据库连接数过高 (${totalCount}/100, ${connectionUsagePercent.toFixed(1)}%)，需要立即处理`);
  } else if (connectionUsagePercent > 70 || activeCount > 50) {
    severity = SEVERITY.HIGH;
    recommendations.push(`数据库连接数较高，建议检查连接泄漏`);
  } else if (connectionUsagePercent > 50 || activeCount > 30) {
    severity = SEVERITY.MEDIUM;
    recommendations.push('数据库连接数偏高');
  }

  if (longQueryCount > 5) {
    severity = Math.max(severity, SEVERITY.HIGH);
    recommendations.push(`${longQueryCount} 个查询运行超过 30 秒，需要优化`);
  } else if (longQueryCount > 0) {
    severity = Math.max(severity, SEVERITY.MEDIUM);
    recommendations.push(`${longQueryCount} 个查询运行时间较长`);
  }

  if (idleInTransCount > 10) {
    severity = Math.max(severity, SEVERITY.HIGH);
    recommendations.push(`${idleInTransCount} 个连接处于 idle in transaction 状态，可能存在长事务`);
  }

  if (staleIdleCount > 20) {
    severity = Math.max(severity, SEVERITY.MEDIUM);
    recommendations.push(`${staleIdleCount} 个 idle 连接超过 30 分钟，建议清理`);
  }

  if (severity === SEVERITY.LOW) {
    recommendations.push('数据库连接正常');
  }

  return {
    bottleneck_area: bottleneckArea,
    severity,
    details: {
      total_connections: totalCount,
      active_connections: activeCount,
      idle_connections: idleCount,
      idle_in_transaction: idleInTransCount,
      long_queries_30s: longQueryCount,
      stale_idle_30m: staleIdleCount,
      connection_usage_percent: Math.round(connectionUsagePercent * 10) / 10,
    },
    recommendations,
  };
}

/**
 * 任务类型失败率扫描
 * @param {import('pg').Pool} pool
 * @returns {Promise<Object>}
 */
async function scanTaskTypeFailure(pool) {
  // 按 task_type 分组统计失败率（过去 24 小时）
  const taskTypeStatsResult = await pool.query(`
    SELECT
      t.task_type,
      COUNT(*) FILTER (WHERE tr.status = 'failed') AS failed_count,
      COUNT(*) AS total_count,
      ROUND(COUNT(*) FILTER (WHERE tr.status = 'failed')::numeric * 100.0 / NULLIF(COUNT(*), 0), 2) AS failure_rate
    FROM tasks t
    LEFT JOIN task_runs tr ON tr.task_id = t.id
    WHERE tr.started_at >= NOW() - INTERVAL '24 hours'
    GROUP BY t.task_type
    HAVING COUNT(*) > 0
    ORDER BY failure_rate DESC, total_count DESC
  `);

  const taskTypeStats = taskTypeStatsResult.rows.map(row => ({
    task_type: row.task_type,
    total_count: parseInt(row.total_count ?? 0, 10),
    failed_count: parseInt(row.failed_count ?? 0, 10),
    failure_rate: parseFloat(row.failure_rate ?? 0),
  }));

  // 计算总体失败率
  const totalFailed = taskTypeStats.reduce((sum, stat) => sum + stat.failed_count, 0);
  const totalCount = taskTypeStats.reduce((sum, stat) => sum + stat.total_count, 0);
  const overallFailureRate = totalCount > 0 ? (totalFailed / totalCount) * 100 : 0;

  // 识别经常失败的任务类型（失败率 > 20% 且任务数 > 5）
  const problematicTypes = taskTypeStats.filter(
    stat => stat.failure_rate > 20 && stat.total_count > 5
  );

  // 判断严重程度
  let severity = SEVERITY.LOW;
  let bottleneckArea = 'task_type_failure';
  const recommendations = [];

  if (overallFailureRate > 50) {
    severity = SEVERITY.CRITICAL;
    recommendations.push(`总体失败率过高 (${overallFailureRate.toFixed(1)}%)，需要立即排查`);
  } else if (overallFailureRate > 30) {
    severity = SEVERITY.HIGH;
    recommendations.push(`总体失败率偏高 (${overallFailureRate.toFixed(1)}%)，建议检查调度`);
  } else if (overallFailureRate > 15) {
    severity = SEVERITY.MEDIUM;
    recommendations.push(`存在一定失败率 (${overallFailureRate.toFixed(1)}%)`);
  }

  if (problematicTypes.length > 0) {
    severity = Math.max(severity, SEVERITY.HIGH);
    const typeNames = problematicTypes.map(t => `${t.task_type}(${t.failure_rate.toFixed(1)}%)`).join(', ');
    recommendations.push(`以下任务类型失败率较高: ${typeNames}`);
  }

  if (severity === SEVERITY.LOW) {
    recommendations.push('任务类型失败率正常');
  }

  return {
    bottleneck_area: bottleneckArea,
    severity,
    details: {
      overall_failure_rate: Math.round(overallFailureRate * 10) / 10,
      total_tasks_24h: totalCount,
      total_failed_24h: totalFailed,
      task_type_breakdown: taskTypeStats.slice(0, 10), // 最多记录 10 个类型
      problematic_types: problematicTypes.map(t => t.task_type),
    },
    recommendations,
  };
}

/**
 * Session 超时扫描
 * @param {import('pg').Pool} pool
 * @returns {Promise<Object>}
 */
async function scanSessionTimeout(pool) {
  // 检查 task_runs 中 idle 超过阈值的 sessions
  // 这里的 session 指的是 task_runs 中状态为 running 但长时间没有更新的
  const idleSessionResult = await pool.query(`
    SELECT COUNT(*) AS idle_session_count
    FROM task_runs
    WHERE status = 'running'
      AND updated_at < NOW() - INTERVAL '30 minutes'
  `);

  const idleSessionCount = parseInt(idleSessionResult.rows[0]?.idle_session_count ?? 0, 10);

  // 检查 idle 超过 1 小时的 sessions（严重超时）
  const staleSessionResult = await pool.query(`
    SELECT COUNT(*) AS stale_session_count
    FROM task_runs
    WHERE status = 'running'
      AND updated_at < NOW() - INTERVAL '1 hour'
  `);

  const staleSessionCount = parseInt(staleSessionResult.rows[0]?.stale_session_count ?? 0, 10);

  // 检查最近 1 小时内结束的 sessions
  const recentSessionResult = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'completed') AS completed_count,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
      COUNT(*) AS total_count
    FROM task_runs
    WHERE ended_at >= NOW() - INTERVAL '1 hour'
  `);

  const recentCompleted = parseInt(recentSessionResult.rows[0]?.completed_count ?? 0, 10);
  const recentFailed = parseInt(recentSessionResult.rows[0]?.failed_count ?? 0, 10);
  const recentTotal = parseInt(recentSessionResult.rows[0]?.total_count ?? 0, 10);

  // 判断严重程度
  let severity = SEVERITY.LOW;
  let bottleneckArea = 'session_timeout';
  const recommendations = [];

  if (staleSessionCount > 5) {
    severity = SEVERITY.CRITICAL;
    recommendations.push(`${staleSessionCount} 个 session 超过 1 小时无响应，需要强制终止`);
  } else if (idleSessionCount > 10) {
    severity = SEVERITY.HIGH;
    recommendations.push(`${idleSessionCount} 个 session 超过 30 分钟无响应，建议检查`);
  } else if (idleSessionCount > 3) {
    severity = SEVERITY.MEDIUM;
    recommendations.push(`${idleSessionCount} 个 session 处于 idle 状态`);
  }

  if (recentTotal > 0) {
    const recentFailureRate = (recentFailed / recentTotal) * 100;
    if (recentFailureRate > 50) {
      severity = Math.max(severity, SEVERITY.HIGH);
      recommendations.push(`最近 1 小时失败率过高 (${recentFailureRate.toFixed(1)}%)`);
    }
  }

  if (severity === SEVERITY.LOW) {
    recommendations.push('Session 状态正常');
  }

  return {
    bottleneck_area: bottleneckArea,
    severity,
    details: {
      idle_sessions_30m: idleSessionCount,
      stale_sessions_1h: staleSessionCount,
      recent_completed_1h: recentCompleted,
      recent_failed_1h: recentFailed,
      recent_total_1h: recentTotal,
    },
    recommendations,
  };
}

/**
 * 记录瓶颈扫描结果到数据库
 * @param {import('pg').Pool} pool
 * @param {string} scanType
 * @param {Object} result
 */
async function recordBottleneckScan(pool, scanType, result) {
  await pool.query(
    `INSERT INTO bottleneck_scans (scan_type, bottleneck_area, severity, details, recommendations)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      scanType,
      result.bottleneck_area,
      result.severity,
      JSON.stringify(result.details),
      JSON.stringify(result.recommendations),
    ]
  );
}

/**
 * 获取最近的扫描结果
 * @param {import('pg').Pool} pool
 * @param {string} scanType - 可选的扫描类型过滤
 * @param {number} limit - 返回数量限制
 * @returns {Promise<Array>}
 */
async function getRecentScans(pool, scanType = null, limit = 10) {
  let query = `
    SELECT id, scan_type, bottleneck_area, severity, details, recommendations, created_at
    FROM bottleneck_scans
  `;
  const params = [];

  if (scanType) {
    query += ` WHERE scan_type = $1`;
    params.push(scanType);
  }

  query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const result = await pool.query(query, params);
  return result.rows;
}

export {
  runBottleneckScan,
  scanSystemPerformance,
  scanQueueDepth,
  scanTaskStuck,
  scanResourceUsage,
  scanDbConnections,
  scanTaskTypeFailure,
  scanSessionTimeout,
  recordBottleneckScan,
  getRecentScans,
  SCAN_TYPES,
  SEVERITY,
};
