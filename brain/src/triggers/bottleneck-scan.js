/**
 * 瓶颈扫描触发器
 *
 * 定时触发系统瓶颈扫描，并将结果存储到数据库。
 * 扫描类型包括：
 *   - system_performance: 系统性能
 *   - queue_depth: 队列深度
 *   - task_stuck: 任务卡住
 *   - resource_usage: 资源使用
 *   - db_connections: 数据库连接
 *   - task_type_failure: 任务类型失败率
 *   - session_timeout: Session 超时
 *
 * 默认扫描间隔：1 小时（与 health-monitor 错开）
 */

import pool from '../db.js';
import { runBottleneckScan, SCAN_TYPES, getRecentScans } from '../services/health-monitor-collector.js';

// 默认扫描间隔：1 小时
const DEFAULT_SCAN_INTERVAL_MS = 60 * 60 * 1000;

// 所有扫描类型
const ALL_SCAN_TYPES = [
  SCAN_TYPES.SYSTEM_PERFORMANCE,
  SCAN_TYPES.QUEUE_DEPTH,
  SCAN_TYPES.TASK_STUCK,
  SCAN_TYPES.RESOURCE_USAGE,
  SCAN_TYPES.DB_CONNECTIONS,
  SCAN_TYPES.TASK_TYPE_FAILURE,
  SCAN_TYPES.SESSION_TIMEOUT,
];

/**
 * 执行所有类型的瓶颈扫描
 * @param {import('pg').Pool} pool - 数据库连接池
 * @param {Object} options - 选项
 * @param {number} options.intervalMs - 扫描间隔（毫秒）
 * @param {number} options.lastScanTime - 上次扫描时间戳
 * @returns {Promise<{scans: Array, nextScanTime: number}>}
 */
async function triggerBottleneckScan(pool, options = {}) {
  const { intervalMs = DEFAULT_SCAN_INTERVAL_MS, lastScanTime = 0 } = options;

  const now = Date.now();
  const elapsed = now - lastScanTime;

  // 检查是否需要触发扫描
  if (elapsed < intervalMs) {
    return {
      scans: [],
      nextScanTime: lastScanTime + intervalMs,
      skipped: true,
      reason: `Not time yet (elapsed: ${Math.round(elapsed / 1000)}s, interval: ${Math.round(intervalMs / 1000)}s)`,
    };
  }

  const scanResults = [];

  // 依次执行各类扫描
  for (const scanType of ALL_SCAN_TYPES) {
    try {
      const result = await runBottleneckScan(pool, scanType);
      scanResults.push(result);
      console.log(`[bottleneck-scan] ${scanType}: ${result.severity} - ${result.bottleneck_area}`);
    } catch (err) {
      console.error(`[bottleneck-scan] ${scanType} failed:`, err.message);
      scanResults.push({
        scan_type: scanType,
        error: err.message,
        scanned_at: new Date().toISOString(),
      });
    }
  }

  // 统计结果
  const severityCounts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  for (const result of scanResults) {
    if (result.severity && severityCounts.hasOwnProperty(result.severity)) {
      severityCounts[result.severity]++;
    }
  }

  const summary = Object.entries(severityCounts)
    .filter(([, count]) => count > 0)
    .map(([severity, count]) => `${count} ${severity}`)
    .join(', ');

  console.log(`[bottleneck-scan] Completed: ${summary || 'no issues'}`);

  // 写入 cecelia_events 表（统一展示）
  if (scanResults.length > 0) {
    try {
      await pool.query(
        `INSERT INTO cecelia_events (event_type, source, payload)
         VALUES ('bottleneck_scan', 'brain_bottleneck_scanner', $1)`,
        [JSON.stringify({
          scan_type: 'batch_scan',
          severity_counts: severityCounts,
          summary,
          scanned_at: new Date().toISOString(),
          scans: scanResults.map(s => ({
            scan_type: s.scan_type,
            bottleneck_area: s.bottleneck_area,
            severity: s.severity,
            recommendations: s.recommendations,
          })),
        })]
      );
      console.log(`[bottleneck-scan] Written to cecelia_events`);
    } catch (err) {
      console.error(`[bottleneck-scan] Failed to write cecelia_events:`, err.message);
    }
  }

  return {
    scans: scanResults,
    nextScanTime: now,
    severity_counts: severityCounts,
    summary,
  };
}

/**
 * 执行单个扫描类型
 * @param {import('pg').Pool} pool
 * @param {string} scanType
 * @returns {Promise<Object>}
 */
async function triggerSingleScan(pool, scanType) {
  if (!ALL_SCAN_TYPES.includes(scanType)) {
    throw new Error(`Unknown scan type: ${scanType}. Valid types: ${ALL_SCAN_TYPES.join(', ')}`);
  }

  return await runBottleneckScan(pool, scanType);
}

/**
 * 获取扫描状态
 * @param {import('pg').Pool} pool
 * @param {number} limit - 最近扫描记录数
 * @returns {Promise<Object>}
 */
async function getScanStatus(pool, limit = 10) {
  const recentScans = await getRecentScans(pool, null, limit);

  // 按扫描类型分组
  const byType = {};
  for (const scan of recentScans) {
    if (!byType[scan.scan_type]) {
      byType[scan.scan_type] = [];
    }
    byType[scan.scan_type].push(scan);
  }

  // 计算各类型的最新严重程度
  const latestByType = {};
  for (const [type, scans] of Object.entries(byType)) {
    if (scans.length > 0) {
      latestByType[type] = {
        severity: scans[0].severity,
        bottleneck_area: scans[0].bottleneck_area,
        created_at: scans[0].created_at,
      };
    }
  }

  return {
    total_scans: recentScans.length,
    by_type: byType,
    latest_by_type: latestByType,
  };
}

export {
  triggerBottleneckScan,
  triggerSingleScan,
  getScanStatus,
  SCAN_TYPES,
  ALL_SCAN_TYPES,
  DEFAULT_SCAN_INTERVAL_MS,
};
