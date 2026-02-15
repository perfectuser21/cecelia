/**
 * Alertness Diagnosis - 诊断引擎
 *
 * 识别异常模式：
 * 1. 持续高负载
 * 2. 内存泄漏
 * 3. 响应退化
 * 4. 错误暴增
 * 5. 队列阻塞
 */

/* global console */

// ============================================================
// 异常模式定义
// ============================================================

const ANOMALY_PATTERNS = {
  HIGH_LOAD: {
    name: '持续高负载',
    description: '连续 3 个 tick CPU > 70%',
    severity: 'high',
    checks: (metrics, history) => {
      if (history.length < 3) return false;
      const recentCpu = history.slice(-3).map(h => h.metrics?.cpu?.value || 0);
      return recentCpu.every(cpu => cpu > 70);
    }
  },

  MEMORY_LEAK: {
    name: '内存泄漏',
    description: '内存持续上涨 > 10MB/分钟',
    severity: 'high',
    checks: (metrics, history) => {
      if (history.length < 5) return false;

      const recentMemory = history.slice(-5).map(h => ({
        value: h.metrics?.memory?.value || 0,
        timestamp: h.timestamp
      }));

      // 计算内存增长率
      const firstMem = recentMemory[0];
      const lastMem = recentMemory[recentMemory.length - 1];
      const timeDiffMinutes = (lastMem.timestamp - firstMem.timestamp) / 60000;

      if (timeDiffMinutes === 0) return false;

      const memGrowthRate = (lastMem.value - firstMem.value) / timeDiffMinutes;
      return memGrowthRate > 10; // 10MB/分钟
    }
  },

  RESPONSE_DEGRADATION: {
    name: '响应退化',
    description: '响应时间比基线慢 3 倍',
    severity: 'medium',
    checks: (metrics, history) => {
      if (!metrics.responseTime) return false;

      // 计算基线（取历史平均值）
      const historicalResponseTimes = history
        .slice(0, -1) // 排除当前
        .map(h => h.metrics?.responseTime?.value || 0)
        .filter(v => v > 0);

      if (historicalResponseTimes.length === 0) return false;

      const baseline = historicalResponseTimes.reduce((a, b) => a + b, 0) / historicalResponseTimes.length;
      const current = metrics.responseTime.value;

      return current > baseline * 3;
    }
  },

  ERROR_SPIKE: {
    name: '错误暴增',
    description: '错误率突增 > 50%',
    severity: 'high',
    checks: (metrics, history) => {
      if (!metrics.errorRate) return false;

      // 获取之前的错误率
      const previousErrorRates = history
        .slice(-5, -1) // 最近5个，排除当前
        .map(h => h.metrics?.errorRate?.value || 0);

      if (previousErrorRates.length === 0) return false;

      const avgPreviousRate = previousErrorRates.reduce((a, b) => a + b, 0) / previousErrorRates.length;
      const current = metrics.errorRate.value;

      // 检查是否突增超过50%（绝对值）或相对增长超过2倍
      return (current - avgPreviousRate > 50) || (avgPreviousRate > 0 && current > avgPreviousRate * 2);
    }
  },

  QUEUE_BLOCKAGE: {
    name: '队列阻塞',
    description: '队列深度持续 > 30',
    severity: 'medium',
    checks: (metrics, history) => {
      if (!metrics.queueDepth) return false;

      // 检查最近3个记录
      const recentQueues = history.slice(-3).map(h => h.metrics?.queueDepth?.value || 0);
      recentQueues.push(metrics.queueDepth.value);

      return recentQueues.every(depth => depth > 30);
    }
  }
};

// ============================================================
// 诊断逻辑
// ============================================================

/**
 * 诊断系统问题
 */
export async function diagnoseProblem(metrics, history = []) {
  const issues = [];
  const patterns = [];

  // 检查每个异常模式
  for (const [key, pattern] of Object.entries(ANOMALY_PATTERNS)) {
    if (pattern.checks(metrics, history)) {
      issues.push(key.toLowerCase());
      patterns.push({
        type: key,
        name: pattern.name,
        description: pattern.description,
        severity: pattern.severity
      });
    }
  }

  // 确定总体严重程度
  const severity = determineSeverity(patterns);

  // 生成诊断摘要
  const summary = generateSummary(patterns, metrics);

  // 生成建议
  const recommendations = generateRecommendations(issues);

  return {
    timestamp: Date.now(),
    issues,
    patterns,
    severity,
    summary,
    recommendations,
    metrics: simplifyMetrics(metrics)
  };
}

/**
 * 确定总体严重程度
 */
function determineSeverity(patterns) {
  if (patterns.length === 0) return 'none';

  const severities = patterns.map(p => p.severity);

  if (severities.includes('critical')) return 'critical';
  if (severities.includes('high')) return 'high';
  if (severities.includes('medium')) return 'medium';
  return 'low';
}

/**
 * 生成诊断摘要
 */
function generateSummary(patterns, metrics) {
  if (patterns.length === 0) {
    return 'System is healthy';
  }

  const patternNames = patterns.map(p => p.name).join('、');
  const criticalMetrics = [];

  if (metrics.memory?.status === 'danger') {
    criticalMetrics.push(`内存 ${metrics.memory.value}MB`);
  }
  if (metrics.cpu?.status === 'danger') {
    criticalMetrics.push(`CPU ${metrics.cpu.value}%`);
  }
  if (metrics.errorRate?.status === 'danger') {
    criticalMetrics.push(`错误率 ${metrics.errorRate.value}%`);
  }

  let summary = `检测到 ${patterns.length} 个异常: ${patternNames}`;
  if (criticalMetrics.length > 0) {
    summary += ` (${criticalMetrics.join(', ')})`;
  }

  return summary;
}

/**
 * 生成建议
 */
function generateRecommendations(issues) {
  const recommendations = [];

  if (issues.includes('high_load')) {
    recommendations.push('reduce_concurrent_tasks');
    recommendations.push('increase_tick_interval');
  }

  if (issues.includes('memory_leak')) {
    recommendations.push('force_garbage_collection');
    recommendations.push('restart_process');
  }

  if (issues.includes('response_degradation')) {
    recommendations.push('optimize_slow_queries');
    recommendations.push('reduce_task_complexity');
  }

  if (issues.includes('error_spike')) {
    recommendations.push('review_error_logs');
    recommendations.push('enable_circuit_breaker');
  }

  if (issues.includes('queue_blockage')) {
    recommendations.push('increase_worker_capacity');
    recommendations.push('prioritize_critical_tasks');
  }

  return recommendations;
}

/**
 * 简化指标（用于诊断报告）
 */
function simplifyMetrics(metrics) {
  const simplified = {};

  for (const [key, metric] of Object.entries(metrics)) {
    if (metric) {
      simplified[key] = {
        value: metric.value,
        status: metric.status,
        unit: metric.unit
      };
    }
  }

  return simplified;
}

// ============================================================
// 获取异常模式
// ============================================================

/**
 * 获取所有定义的异常模式
 */
export function getAnomalyPatterns() {
  return Object.entries(ANOMALY_PATTERNS).map(([key, pattern]) => ({
    key,
    name: pattern.name,
    description: pattern.description,
    severity: pattern.severity
  }));
}

// ============================================================
// 导出
// ============================================================

export default {
  diagnoseProblem,
  getAnomalyPatterns,
  ANOMALY_PATTERNS
};