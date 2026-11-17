/**
 * Monitoring Loop - 持续监控和规则恢复
 * 
 * 职责：
 * 1. 每 30 秒扫描 run_events / tasks 状态
 * 2. 检测异常：stuck, failure_spike, resource_pressure
 * 3. 自动处置：retry, quarantine, throttle
 * 4. 只在必要时升级到 Cortex 或通知人类
 * 
 * 原则：
 * - 先用规则，不用推理（快、便宜、确定性）
 * - 推理只处理"值得推理的"（24h 内同类问题只推理一次）
 * - 人类只处理"需要授权/影响大/花钱"的决策
 */

import pool from './db.js';
import { handleStuckRun } from './monitor-recovery.js';
import { handleFailureSpike, FAILURE_SPIKE_THRESHOLD } from './monitor-failure-handler.js';
import { MONITOR_LONG_RUNNING_TASK_TYPES, RETIRED_DEVELOPMENT_TASK_TYPES } from './lib/task-type-registry.js';

// Configuration
const MONITOR_INTERVAL_MS = 30000; // 30 seconds
const STUCK_THRESHOLD_MINUTES = 5;
// 现役长时评审任务允许更长心跳间隔，普通任务仍使用5分钟。
const LONG_RUNNING_STUCK_THRESHOLD_MINUTES = 30;
const RESOURCE_PRESSURE_THRESHOLD = 0.85;

// State
let _monitorTimer = null;
let _monitoring = false;
let _lastCycleAt = null;
let _cycleCount = 0;

/**
 * Detector: Stuck Runs
 * 检测卡住的任务（心跳超时或运行时间过长）
 *
 */
async function detectStuckRuns() {
  const query = `
    SELECT
      r.run_id,
      r.task_id,
      r.span_id,
      r.layer,
      r.step_name,
      r.ts_start,
      r.heartbeat_ts,
      EXTRACT(EPOCH FROM (NOW() - r.heartbeat_ts)) / 60 AS minutes_since_heartbeat
    FROM run_events r
    LEFT JOIN tasks t ON t.id = r.task_id
    WHERE r.status = 'running'
      AND (t.task_type IS NULL OR t.task_type <> ALL($2::text[]))
      AND (
        -- Standard tasks: 5-minute threshold
        (t.task_type IS NULL OR t.task_type != ALL($1::text[]))
        AND r.heartbeat_ts < NOW() - INTERVAL '${STUCK_THRESHOLD_MINUTES} minutes'
        OR
        -- Long-running reviews: 30-minute threshold
        (t.task_type = ANY($1::text[]))
        AND r.heartbeat_ts < NOW() - INTERVAL '${LONG_RUNNING_STUCK_THRESHOLD_MINUTES} minutes'
      )
    ORDER BY r.heartbeat_ts ASC
    LIMIT 10
  `;

  const result = await pool.query(query, [MONITOR_LONG_RUNNING_TASK_TYPES, RETIRED_DEVELOPMENT_TASK_TYPES]);
  return result.rows;
}

/**
 * Detector: Failure Spike
 * 检测失败率激增（最近 1 小时）
 */
async function detectFailureSpike() {
  const query = `
    SELECT 
      COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
      COUNT(*) AS total_count,
      ROUND(
        COUNT(*) FILTER (WHERE status = 'failed')::numeric / 
        NULLIF(COUNT(*), 0), 
        2
      ) AS failure_rate
    FROM run_events
    WHERE ts_start > NOW() - INTERVAL '1 hour'
  `;
  
  const result = await pool.query(query);
  const row = result.rows[0] || {};

  return {
    failed_count: parseInt(row.failed_count) || 0,
    total_count: parseInt(row.total_count) || 0,
    failure_rate: parseFloat(row.failure_rate) || 0
  };
}

export { detectFailureSpike };
// handleStuckRun 导出供 monitor-stuck-terminal.test.js 直接调（issue 219a9efc 终态调和回归）
export { handleStuckRun };

/**
 * Detector: Resource Pressure
 * 检测系统压力（活跃任务数 / 最大并发）并采集 CPU/RSS 指标
 */
async function detectResourcePressure() {
  const { getActiveProcessCount, MAX_SEATS } = await import('./executor.js');
  const activeCount = getActiveProcessCount();
  const pressure = activeCount / MAX_SEATS;

  // 采集进程级 CPU 和内存 RSS（Node.js 自身）
  const memUsage = process.memoryUsage();
  const rssMB = Math.round(memUsage.rss / 1024 / 1024);

  // cpuUsage() 返回微秒累计，取两次快照算近似 %
  // 注：monitor 每 30s 调用，此处仅记录瞬时 RSS，CPU% 近似为 user+sys / elapsed
  const cpuBefore = process.cpuUsage();
  const wallStart = Date.now();
  // 同步等待 ~10ms 采样窗口（够精度，不阻塞）
  await new Promise(resolve => setTimeout(resolve, 10));
  const cpuAfter = process.cpuUsage(cpuBefore);
  const elapsedMs = Date.now() - wallStart;
  const cpuPercent = Math.round(((cpuAfter.user + cpuAfter.system) / 1000 / elapsedMs) * 100 * 10) / 10;

  return {
    active_count: activeCount,
    max_seats: MAX_SEATS,
    pressure: pressure,
    rss_mb: rssMB,
    cpu_percent: cpuPercent,
  };
}

/**
 * Handler: Handle Resource Pressure
 * 处置资源压力
 */
async function handleResourcePressure(stats) {
  console.log(`[Monitor] Resource pressure: ${(stats.pressure * 100).toFixed(1)}% (${stats.active_count}/${stats.max_seats})`);
  
  if (stats.pressure > 0.9) {
    // Critical: throttle new dispatches
    console.log(`[Monitor] Action: THROTTLE - High pressure detected (${(stats.pressure * 100).toFixed(1)}%)`);

    // 写入 throttle_activated 事件，供 slot-allocator 和 dashboard 消费
    try {
      await pool.query(
        `INSERT INTO cecelia_events (event_type, source, payload)
         VALUES ('throttle_activated', 'monitor_loop', $1)`,
        [JSON.stringify({
          pressure: stats.pressure,
          active_count: stats.active_count,
          max_seats: stats.max_seats,
          rss_mb: stats.rss_mb,
          cpu_percent: stats.cpu_percent,
          timestamp: new Date().toISOString()
        })]
      );
    } catch (throttleErr) {
      console.error(`[Monitor] Failed to record throttle_activated: ${throttleErr.message}`);
    }
  }
}

/**
 * Main monitoring loop
 */
async function runMonitorCycle() {
  if (_monitoring) {
    console.log('[Monitor] Previous cycle still running, skipping');
    return;
  }
  
  _monitoring = true;
  const startTime = Date.now();
  
  try {
    // 1. Detect stuck runs
    const stuckRuns = await detectStuckRuns();
    if (stuckRuns.length > 0) {
      console.log(`[Monitor] Found ${stuckRuns.length} stuck runs`);
      for (const stuck of stuckRuns) {
        await handleStuckRun(stuck);
      }
    }
    
    // 2. Detect failures and run immune system
    // 关键：absorption_policy 是 signature 级别的规则，不能用系统级 failure_rate
    // 卡住免疫系统——单签名重复失败、整体 rate 不到 30% 时，规则永远不会被检查、
    // 不会被计数、不会被晋升，制造"规则存在但不执行"的虚假安全感
    // (Cortex Insight learning 81cba57d)。
    // 只要有失败就跑免疫流程；failure_rate 仅作为日志/告警维度保留。
    const failureStats = await detectFailureSpike();
    if (failureStats.failed_count > 0) {
      await handleFailureSpike(failureStats);
    }
    
    // 3. Detect resource pressure
    const resourceStats = await detectResourcePressure();
    if (resourceStats.pressure > RESOURCE_PRESSURE_THRESHOLD) {
      await handleResourcePressure(resourceStats);
    }

    // 4. 记录资源快照（每次 cycle 写入，用于事后性能分析）
    try {
      await pool.query(
        `INSERT INTO cecelia_events (event_type, payload, created_at) VALUES ('resource_snapshot', $1, NOW())`,
        [JSON.stringify({
          cpu_percent: resourceStats.cpu_percent,
          rss_mb: resourceStats.rss_mb,
          active_processes: resourceStats.active_count,
          max_seats: resourceStats.max_seats,
          utilization: resourceStats.pressure,
        })]
      );
    } catch (snapshotErr) {
      // 写入失败不影响 monitor 主流程
      console.warn(`[Monitor] resource_snapshot 写入失败: ${snapshotErr.message}`);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[Monitor] Cycle completed in ${elapsed}ms`);
    _lastCycleAt = Date.now();
    _cycleCount++;

  } catch (error) {
    console.error('[Monitor] Error in monitoring cycle:', error);
  } finally {
    _monitoring = false;
  }
}

/**
 * Start monitoring loop
 */
export function startMonitorLoop() {
  if (_monitorTimer) {
    console.log('[Monitor] Loop already running');
    return;
  }
  
  console.log(`[Monitor] Starting monitoring loop (interval: ${MONITOR_INTERVAL_MS}ms)`);
  
  // Run first cycle immediately
  runMonitorCycle();
  
  // Then run periodically
  _monitorTimer = setInterval(runMonitorCycle, MONITOR_INTERVAL_MS);
}

/**
 * Get monitoring status
 */
export function getMonitorStatus() {
  return {
    running: _monitorTimer !== null,
    monitoring: _monitoring,
    interval_ms: MONITOR_INTERVAL_MS,
    last_cycle_at: _lastCycleAt,
    cycle_count: _cycleCount,
    thresholds: {
      stuck_minutes: STUCK_THRESHOLD_MINUTES,
      failure_spike_rate: FAILURE_SPIKE_THRESHOLD,
      resource_pressure: RESOURCE_PRESSURE_THRESHOLD
    }
  };
}
