/**
 * Alertness Metrics - 指标收集器
 *
 * 收集 5 种核心指标：
 * 1. 内存（RSS）
 * 2. CPU 使用率
 * 3. 响应时间
 * 4. 错误率
 * 5. 队列深度
 */

/* global console, process */

import os from 'os';
import pool from '../db.js';

// ============================================================
// 阈值定义
// ============================================================

const THRESHOLDS = {
  memory: {
    normal: 150,    // < 150MB
    warning: 200,   // 150-200MB
    danger: 300     // > 300MB
  },
  cpu: {
    normal: 30,     // < 30%
    warning: 50,    // 30-50%
    danger: 80      // > 80%
  },
  responseTime: {
    normal: 2000,   // < 2s
    warning: 5000,  // 2-5s
    danger: 10000   // > 10s
  },
  errorRate: {
    normal: 10,     // < 10%
    warning: 30,    // 10-30%
    danger: 50      // > 50%
  },
  queueDepth: {
    normal: 10,     // < 10
    warning: 20,    // 10-20
    danger: 50      // > 50
  }
};

// ============================================================
// 指标缓存
// ============================================================

let metricsCache = {
  memory: { value: 0, status: 'normal', timestamp: Date.now() },
  cpu: { value: 0, status: 'normal', timestamp: Date.now() },
  responseTime: { value: 0, status: 'normal', timestamp: Date.now() },
  errorRate: { value: 0, status: 'normal', timestamp: Date.now() },
  queueDepth: { value: 0, status: 'normal', timestamp: Date.now() }
};

// 响应时间历史（用于计算平均值）
let responseTimeHistory = [];
const MAX_RESPONSE_HISTORY = 10;

// 操作历史（用于计算错误率）
let operationHistory = [];
const MAX_OPERATION_HISTORY = 10;

// CPU 使用历史（用于平滑波动）
let cpuHistory = [];
const MAX_CPU_HISTORY = 3;

// ============================================================
// 指标收集
// ============================================================

/**
 * 收集所有指标
 */
export async function collectMetrics() {
  const metrics = {};

  // 1. 内存指标
  metrics.memory = collectMemoryMetric();

  // 2. CPU 指标
  metrics.cpu = collectCPUMetric();

  // 3. 响应时间
  metrics.responseTime = await collectResponseTimeMetric();

  // 4. 错误率
  metrics.errorRate = collectErrorRateMetric();

  // 5. 队列深度
  metrics.queueDepth = await collectQueueDepthMetric();

  // 更新缓存
  metricsCache = metrics;

  return metrics;
}

/**
 * 收集内存指标
 */
function collectMemoryMetric() {
  const memUsage = process.memoryUsage();
  const rssMB = Math.round(memUsage.rss / 1024 / 1024);

  const status = getThresholdStatus(rssMB, THRESHOLDS.memory);

  return {
    value: rssMB,
    status,
    unit: 'MB',
    timestamp: Date.now()
  };
}

/**
 * 收集 CPU 指标
 */
function collectCPUMetric() {
  const loadAvg = os.loadavg()[0]; // 1分钟负载均值
  const cpuCount = os.cpus().length;
  const cpuPercent = Math.round((loadAvg / cpuCount) * 100);

  // 添加到历史，用于平滑
  cpuHistory.push(cpuPercent);
  if (cpuHistory.length > MAX_CPU_HISTORY) {
    cpuHistory.shift();
  }

  // 使用移动平均平滑波动
  const smoothedCpu = Math.round(
    cpuHistory.reduce((a, b) => a + b, 0) / cpuHistory.length
  );

  const status = getThresholdStatus(smoothedCpu, THRESHOLDS.cpu);

  return {
    value: smoothedCpu,
    status,
    unit: '%',
    raw: cpuPercent,
    loadAvg,
    timestamp: Date.now()
  };
}

/**
 * 收集响应时间指标
 */
async function collectResponseTimeMetric() {
  // 获取最近 Tick 执行时间
  const recentTickTime = await getRecentTickTime();

  if (recentTickTime !== null) {
    responseTimeHistory.push(recentTickTime);
    if (responseTimeHistory.length > MAX_RESPONSE_HISTORY) {
      responseTimeHistory.shift();
    }
  }

  // 计算平均响应时间
  const avgResponseTime = responseTimeHistory.length > 0
    ? Math.round(responseTimeHistory.reduce((a, b) => a + b, 0) / responseTimeHistory.length)
    : 0;

  const status = getThresholdStatus(avgResponseTime, THRESHOLDS.responseTime);

  return {
    value: avgResponseTime,
    status,
    unit: 'ms',
    samples: responseTimeHistory.length,
    timestamp: Date.now()
  };
}

/**
 * 收集错误率指标
 */
function collectErrorRateMetric() {
  // 计算最近操作的错误率
  const totalOperations = operationHistory.length;
  const failedOperations = operationHistory.filter(op => !op.success).length;

  const errorRate = totalOperations > 0
    ? Math.round((failedOperations / totalOperations) * 100)
    : 0;

  const status = getThresholdStatus(errorRate, THRESHOLDS.errorRate);

  return {
    value: errorRate,
    status,
    unit: '%',
    failed: failedOperations,
    total: totalOperations,
    timestamp: Date.now()
  };
}

/**
 * 收集队列深度指标
 */
async function collectQueueDepthMetric() {
  const queueDepth = await getQueueDepth();
  const status = getThresholdStatus(queueDepth, THRESHOLDS.queueDepth);

  return {
    value: queueDepth,
    status,
    unit: 'tasks',
    timestamp: Date.now()
  };
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 获取阈值状态
 */
function getThresholdStatus(value, thresholds) {
  if (value >= thresholds.danger) return 'danger';
  if (value >= thresholds.warning) return 'warning';
  return 'normal';
}

/**
 * 获取最近 Tick 执行时间
 */
async function getRecentTickTime() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT execution_time_ms
      FROM tick_history
      WHERE completed_at IS NOT NULL
      ORDER BY started_at DESC
      LIMIT 1
    `);

    return result.rows.length > 0 ? result.rows[0].execution_time_ms : null;
  } catch (error) {
    console.error('[Metrics] Failed to get tick time:', error);
    return null;
  } finally {
    client.release();
  }
}

/**
 * 获取队列深度
 */
async function getQueueDepth() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT COUNT(*) as count
      FROM tasks
      WHERE status IN ('queued', 'pending')
    `);

    return parseInt(result.rows[0].count, 10);
  } catch (error) {
    console.error('[Metrics] Failed to get queue depth:', error);
    return 0;
  } finally {
    client.release();
  }
}

// ============================================================
// 操作记录
// ============================================================

/**
 * 记录操作结果（用于计算错误率）
 */
export function recordOperation(success, operation = 'unknown') {
  operationHistory.push({
    success,
    operation,
    timestamp: Date.now()
  });

  if (operationHistory.length > MAX_OPERATION_HISTORY) {
    operationHistory.shift();
  }
}

/**
 * 记录 Tick 执行时间
 */
export function recordTickTime(durationMs) {
  responseTimeHistory.push(durationMs);
  if (responseTimeHistory.length > MAX_RESPONSE_HISTORY) {
    responseTimeHistory.shift();
  }
}

// ============================================================
// 指标分析
// ============================================================

/**
 * 计算综合健康分数（0-100）
 */
export function calculateHealthScore(metrics) {
  const weights = {
    memory: 0.25,
    cpu: 0.25,
    responseTime: 0.20,
    errorRate: 0.20,
    queueDepth: 0.10
  };

  let totalScore = 0;

  for (const [key, weight] of Object.entries(weights)) {
    const metric = metrics[key];
    if (!metric) continue;

    // 将状态转换为分数
    let score = 100;
    if (metric.status === 'warning') score = 50;
    if (metric.status === 'danger') score = 0;

    totalScore += score * weight;
  }

  return Math.round(totalScore);
}

/**
 * 获取最近的指标
 */
export function getRecentMetrics() {
  return metricsCache;
}

// ============================================================
// 导出
// ============================================================

export default {
  collectMetrics,
  calculateHealthScore,
  getRecentMetrics,
  recordOperation,
  recordTickTime,
  THRESHOLDS
};