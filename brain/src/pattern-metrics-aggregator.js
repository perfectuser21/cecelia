/**
 * Pattern Metrics Aggregator - 从 run_events 聚合数据到 pattern_metrics
 *
 * 功能：
 * - 增量聚合（每小时/每天）从 run_events 聚合到 pattern_metrics
 * - 支持多维度聚合：agent, skill, layer, task_type, executor_host, region
 * - 错误类型分布聚合：error_types, error_kind_distribution
 * - 质量指标聚合：avg_effectiveness_score
 */

import pool from './db.js';

/**
 * 聚合配置
 */
const AGGREGATION_CONFIG = {
  // 每小时聚合间隔（毫秒）
  HOURLY_INTERVAL_MS: 60 * 60 * 1000,
  // 每天聚合间隔（毫秒）
  DAILY_INTERVAL_MS: 24 * 60 * 60 * 1000,
  // 默认批量大小
  BATCH_SIZE: 1000,
  // 最大重试次数
  MAX_RETRIES: 3
};

// Loop state
let _hourlyTimer = null;
let _dailyTimer = null;
let _hourlyRunning = false;
let _dailyRunning = false;

/**
 * 获取上次聚合时间
 * @param {string} periodType - 'hourly' 或 'daily'
 * @returns {Date|null}
 */
async function getLastAggregationTime(periodType) {
  const result = await pool.query(`
    SELECT MAX(ts_end) as last_ts
    FROM pattern_metrics
    WHERE period_type = $1
  `, [periodType]);

  return result.rows[0]?.last_ts ? new Date(result.rows[0].last_ts) : null;
}

/**
 * 格式化时间范围为周期桶
 * @param {Date} start
 * @param {Date} end
 * @param {string} periodType
 * @returns {{ ts_start: Date, ts_end: Date }}
 */
function getPeriodBucket(start, end, periodType) {
  const bucketStart = new Date(start);

  if (periodType === 'hourly') {
    bucketStart.setMinutes(0, 0, 0);
    const bucketEnd = new Date(bucketStart);
    bucketEnd.setHours(bucketEnd.getHours() + 1);
    return { ts_start: bucketStart, ts_end: bucketEnd };
  } else {
    bucketStart.setHours(0, 0, 0, 0);
    const bucketEnd = new Date(bucketStart);
    bucketEnd.setDate(bucketEnd.getDate() + 1);
    return { ts_start: bucketStart, ts_end: bucketEnd };
  }
}

/**
 * 获取时间范围内的所有周期桶
 * @param {Date} start
 * @param {Date} end
 * @param {string} periodType
 * @returns {Array<{ ts_start: Date, ts_end: Date }>}
 */
function getAllPeriodBuckets(start, end, periodType) {
  const buckets = [];
  let current = new Date(start);

  while (current < end) {
    const bucket = getPeriodBucket(current, end, periodType);
    if (bucket.ts_start >= start && bucket.ts_end <= end) {
      buckets.push(bucket);
    }
    current = periodType === 'hourly'
      ? new Date(current.getTime() + AGGREGATION_CONFIG.HOURLY_INTERVAL_MS)
      : new Date(current.getTime() + AGGREGATION_CONFIG.DAILY_INTERVAL_MS);
  }

  return buckets;
}

/**
 * 获取需要聚合的维度组合
 * @returns {Array<Object>}
 */
async function getAggregationDimensions() {
  // 从 run_events 获取所有唯一的维度组合
  const result = await pool.query(`
    SELECT DISTINCT
      agent,
      layer,
      executor_host,
      region
    FROM run_events
    WHERE ts_start >= now() - interval '7 days'
      AND agent IS NOT NULL
  `);

  return result.rows;
}

/**
 * 聚合单个维度组合的数据
 * @param {Object} dimension - 维度组合
 * @param {Date} tsStart
 * @param {Date} tsEnd
 * @param {string} periodType
 * @returns {Object} 聚合结果
 */
async function aggregateDimension(dimension, tsStart, tsEnd, periodType) {
  const { agent, layer, executor_host, region } = dimension;

  // 构建查询条件
  const conditions = ['ts_start >= $1 AND ts_start < $2'];
  const params = [tsStart, tsEnd];
  let paramIndex = 3;

  if (agent) {
    conditions.push(`agent = $${paramIndex++}`);
    params.push(agent);
  }
  if (layer) {
    conditions.push(`layer = $${paramIndex++}`);
    params.push(layer);
  }
  if (executor_host) {
    conditions.push(`executor_host = $${paramIndex++}`);
    params.push(executor_host);
  }
  if (region) {
    conditions.push(`region = $${paramIndex++}`);
    params.push(region);
  }

  const whereClause = conditions.join(' AND ');

  // 基础统计查询
  const statsResult = await pool.query(`
    SELECT
      COUNT(*) as total_runs,
      COUNT(*) FILTER (WHERE status = 'success') as success_count,
      COUNT(*) FILTER (WHERE status = 'failed') as failure_count,
      SUM(COALESCE(retry_count, 0)) as retry_count,
      AVG(EXTRACT(EPOCH FROM (COALESCE(ts_end, now()) - ts_start)) * 1000) as avg_response_time_ms,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (COALESCE(ts_end, now()) - ts_start)) * 1000) as p95_response_time_ms,
      MAX(EXTRACT(EPOCH FROM (COALESCE(ts_end, now()) - ts_start)) * 1000) as max_response_time_ms,
      MIN(EXTRACT(EPOCH FROM (COALESCE(ts_end, now()) - ts_start)) * 1000) as min_response_time_ms
    FROM run_events
    WHERE ${whereClause}
  `, params);

  // 错误类型分布
  const errorTypesResult = await pool.query(`
    SELECT
      reason_code,
      COUNT(*) as count
    FROM run_events
    WHERE ${whereClause}
      AND status = 'failed'
      AND reason_code IS NOT NULL
    GROUP BY reason_code
  `, params);

  const errorTypes = {};
  for (const row of errorTypesResult.rows) {
    errorTypes[row.reason_code] = parseInt(row.count);
  }

  // 错误种类分布
  const errorKindResult = await pool.query(`
    SELECT
      reason_kind,
      COUNT(*) as count
    FROM run_events
    WHERE ${whereClause}
      AND status = 'failed'
      AND reason_kind IS NOT NULL
    GROUP BY reason_kind
  `, params);

  const errorKindDistribution = {};
  for (const row of errorKindResult.rows) {
    errorKindDistribution[row.reason_kind] = parseInt(row.count);
  }

  // 质量指标 - 从 learnings 表获取 effectiveness_score
  const qualityResult = await pool.query(`
    SELECT
      AVG(COALESCE(effectiveness_score, 0)) as avg_effectiveness_score
    FROM learnings l
    JOIN run_events r ON r.task_id = l.task_id
    WHERE r.ts_start >= $1 AND r.ts_start < $2
      ${agent ? `AND r.agent = $3` : ''}
      ${layer ? `AND r.layer = $${agent ? 4 : 3}` : ''}
  `, agent
    ? (layer ? [tsStart, tsEnd, agent, layer] : [tsStart, tsEnd, agent])
    : [tsStart, tsEnd]);

  const stats = statsResult.rows[0];
  return {
    total_runs: parseInt(stats.total_runs) || 0,
    success_count: parseInt(stats.success_count) || 0,
    failure_count: parseInt(stats.failure_count) || 0,
    retry_count: parseInt(stats.retry_count) || 0,
    avg_response_time_ms: parseFloat(stats.avg_response_time_ms) || 0,
    p95_response_time_ms: parseFloat(stats.p95_response_time_ms) || 0,
    max_response_time_ms: parseFloat(stats.max_response_time_ms) || 0,
    min_response_time_ms: parseFloat(stats.min_response_time_ms) || 0,
    error_types: errorTypes,
    error_kind_distribution: errorKindDistribution,
    avg_effectiveness_score: qualityResult.rows[0]?.avg_effectiveness_score
      ? parseFloat(qualityResult.rows[0].avg_effectiveness_score)
      : null
  };
}

/**
 * 保存聚合结果到 pattern_metrics
 * @param {Object} dimension - 维度
 * @param {Object} stats - 统计数据
 * @param {Date} tsStart
 * @param {Date} tsEnd
 * @param {string} periodType
 */
async function saveAggregationResult(dimension, stats, tsStart, tsEnd, periodType) {
  // Upsert: 如果已存在则更新，否则插入
  await pool.query(`
    INSERT INTO pattern_metrics (
      run_id, task_id, ts_start, ts_end, period_type,
      total_runs, success_count, failure_count, retry_count,
      avg_response_time_ms, p95_response_time_ms, max_response_time_ms, min_response_time_ms,
      error_types, error_kind_distribution,
      agent, skill, layer, executor_host, region,
      avg_effectiveness_score
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
    ON CONFLICT DO NOTHING
  `, [
    null, null, tsStart, tsEnd, periodType,
    stats.total_runs, stats.success_count, stats.failure_count, stats.retry_count,
    stats.avg_response_time_ms, stats.p95_response_time_ms, stats.max_response_time_ms, stats.min_response_time_ms,
    JSON.stringify(stats.error_types), JSON.stringify(stats.error_kind_distribution),
    dimension.agent, null, dimension.layer, dimension.executor_host, dimension.region,
    stats.avg_effectiveness_score
  ]);
}

/**
 * 执行增量聚合
 * @param {string} periodType - 'hourly' 或 'daily'
 * @returns {Object} 聚合结果
 */
async function executeAggregation(periodType) {
  const actionsTaken = [];

  // 获取上次聚合时间
  const lastAggregation = await getLastAggregationTime(periodType);
  const now = new Date();

  // 确定聚合时间范围
  const tsStart = lastAggregation
    ? new Date(lastAggregation.getTime())
    : new Date(now.getTime() - (periodType === 'hourly' ? 24 : 7) * 24 * 60 * 60 * 1000);

  // 限制聚合范围，避免处理过多数据
  const maxRange = periodType === 'hourly'
    ? 2 * AGGREGATION_CONFIG.HOURLY_INTERVAL_MS
    : 2 * AGGREGATION_CONFIG.DAILY_INTERVAL_MS;

  const effectiveTsStart = new Date(Math.max(
    tsStart.getTime(),
    now.getTime() - maxRange
  ));

  if (effectiveTsStart >= now) {
    console.log(`[pattern-metrics-aggregator] No data to aggregate for ${periodType}`);
    return { skipped: true, reason: 'no_data_to_aggregate', period_type: periodType };
  }

  console.log(`[pattern-metrics-aggregator] Starting ${periodType} aggregation from ${effectiveTsStart.toISOString()} to ${now.toISOString()}`);

  // 获取所有时间桶
  const buckets = getAllPeriodBuckets(effectiveTsStart, now, periodType);

  // 获取所有维度组合
  const dimensions = await getAggregationDimensions();

  // 添加一个"全局"维度（无过滤）
  dimensions.unshift({
    agent: null,
    layer: null,
    executor_host: null,
    region: null
  });

  let totalRecords = 0;

  for (const bucket of buckets) {
    for (const dimension of dimensions) {
      try {
        const stats = await aggregateDimension(dimension, bucket.ts_start, bucket.ts_end, periodType);

        // 只保存有数据的记录
        if (stats.total_runs > 0) {
          await saveAggregationResult(dimension, stats, bucket.ts_start, bucket.ts_end, periodType);
          totalRecords++;
        }

        actionsTaken.push({
          bucket_start: bucket.ts_start.toISOString(),
          dimension: dimension,
          total_runs: stats.total_runs
        });
      } catch (err) {
        console.error(`[pattern-metrics-aggregator] Error aggregating bucket ${bucket.ts_start}:`, err.message);
      }
    }
  }

  console.log(`[pattern-metrics-aggregator] Completed ${periodType} aggregation: ${totalRecords} records, ${actionsTaken.length} buckets processed`);

  return {
    success: true,
    period_type: periodType,
    ts_start: effectiveTsStart.toISOString(),
    ts_end: now.toISOString(),
    buckets_processed: buckets.length,
    records_created: totalRecords,
    actions_taken: actionsTaken
  };
}

/**
 * 执行每小时聚合（安全版本）
 */
async function runHourlyAggregationSafe() {
  if (_hourlyRunning) {
    console.log('[pattern-metrics-aggregator] Hourly aggregation already running, skipping');
    return { skipped: true, reason: 'already_running' };
  }

  _hourlyRunning = true;

  try {
    const result = await executeAggregation('hourly');
    return result;
  } catch (err) {
    console.error('[pattern-metrics-aggregator] Hourly aggregation failed:', err.message);
    return { success: false, error: err.message };
  } finally {
    _hourlyRunning = false;
  }
}

/**
 * 执行每天聚合（安全版本）
 */
async function runDailyAggregationSafe() {
  if (_dailyRunning) {
    console.log('[pattern-metrics-aggregator] Daily aggregation already running, skipping');
    return { skipped: true, reason: 'already_running' };
  }

  _dailyRunning = true;

  try {
    const result = await executeAggregation('daily');
    return result;
  } catch (err) {
    console.error('[pattern-metrics-aggregator] Daily aggregation failed:', err.message);
    return { success: false, error: err.message };
  } finally {
    _dailyRunning = false;
  }
}

/**
 * 计算下次运行时间
 * @param {string} periodType - 'hourly' 或 'daily'
 * @returns {number} 毫秒
 */
function msUntilNextAggregation(periodType) {
  const now = new Date();
  let next;

  if (periodType === 'hourly') {
    next = new Date(now);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
  } else {
    next = new Date(now);
    next.setHours(0, 0, 0, 0);
    next.setDate(next.getDate() + 1);
  }

  return next.getTime() - now.getTime();
}

/**
 * 启动每小时聚合调度器
 */
function startHourlyScheduler() {
  if (_hourlyTimer) {
    console.log('[pattern-metrics-aggregator] Hourly scheduler already running');
    return false;
  }

  const scheduleNext = () => {
    const ms = msUntilNextAggregation('hourly');
    console.log(`[pattern-metrics-aggregator] Next hourly aggregation in ${Math.round(ms / 1000 / 60)} minutes`);

    _hourlyTimer = setTimeout(async () => {
      await runHourlyAggregationSafe();
      scheduleNext();
    }, ms);

    if (_hourlyTimer.unref) {
      _hourlyTimer.unref();
    }
  };

  scheduleNext();
  console.log('[pattern-metrics-aggregator] Hourly scheduler started');
  return true;
}

/**
 * 启动每天聚合调度器
 */
function startDailyScheduler() {
  if (_dailyTimer) {
    console.log('[pattern-metrics-aggregator] Daily scheduler already running');
    return false;
  }

  const scheduleNext = () => {
    const ms = msUntilNextAggregation('daily');
    console.log(`[pattern-metrics-aggregator] Next daily aggregation in ${Math.round(ms / 1000 / 60 / 60)} hours`);

    _dailyTimer = setTimeout(async () => {
      await runDailyAggregationSafe();
      scheduleNext();
    }, ms);

    if (_dailyTimer.unref) {
      _dailyTimer.unref();
    }
  };

  scheduleNext();
  console.log('[pattern-metrics-aggregator] Daily scheduler started');
  return true;
}

/**
 * 停止所有调度器
 */
function stopAllSchedulers() {
  if (_hourlyTimer) {
    clearTimeout(_hourlyTimer);
    _hourlyTimer = null;
  }
  if (_dailyTimer) {
    clearTimeout(_dailyTimer);
    _dailyTimer = null;
  }
  console.log('[pattern-metrics-aggregator] All schedulers stopped');
}

/**
 * 获取聚合器状态
 */
function getAggregatorStatus() {
  return {
    hourly_scheduler_running: _hourlyTimer !== null,
    daily_scheduler_running: _dailyTimer !== null,
    hourly_running: _hourlyRunning,
    daily_running: _dailyRunning,
    next_hourly_ms: _hourlyTimer ? msUntilNextAggregation('hourly') : null,
    next_daily_ms: _dailyTimer ? msUntilNextAggregation('daily') : null
  };
}

/**
 * 手动触发聚合（用于测试或补数）
 * @param {string} periodType - 'hourly' 或 'daily'
 * @param {string} dateStr - 日期字符串 YYYY-MM-DD（可选）
 */
async function manualTrigger(periodType, dateStr) {
  if (dateStr) {
    // 聚合指定日期
    const date = new Date(dateStr);
    const tsStart = new Date(date);
    const tsEnd = new Date(date);

    if (periodType === 'hourly') {
      tsStart.setMinutes(0, 0, 0);
      tsEnd.setHours(tsEnd.getHours() + 1);
    } else {
      tsStart.setHours(0, 0, 0, 0);
      tsEnd.setDate(tsEnd.getDate() + 1);
    }

    const dimensions = await getAggregationDimensions();
    dimensions.unshift({ agent: null, layer: null, executor_host: null, region: null });

    let totalRecords = 0;
    for (const dimension of dimensions) {
      const stats = await aggregateDimension(dimension, tsStart, tsEnd, periodType);
      if (stats.total_runs > 0) {
        await saveAggregationResult(dimension, stats, tsStart, tsEnd, periodType);
        totalRecords++;
      }
    }

    return {
      success: true,
      period_type: periodType,
      date: dateStr,
      records_created: totalRecords
    };
  } else {
    // 执行常规聚合
    return periodType === 'hourly'
      ? await runHourlyAggregationSafe()
      : await runDailyAggregationSafe();
  }
}

export {
  executeAggregation,
  runHourlyAggregationSafe,
  runDailyAggregationSafe,
  startHourlyScheduler,
  startDailyScheduler,
  stopAllSchedulers,
  getAggregatorStatus,
  manualTrigger,
  AGGREGATION_CONFIG
};
