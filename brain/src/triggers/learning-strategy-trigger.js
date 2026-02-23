/**
 * Learning to Strategy 转换触发器
 *
 * 定时检查符合条件的 Learning，并将其转换为 Strategy。
 * 触发条件：
 *   - 时间窗口：指定时间窗口内的 learning
 *   - 频率阈值：指定时间窗口内相同 trigger_event 出现次数
 *   - 质量阈值：learning 的 quality_score/confidence >= 阈值
 *
 * 默认检查间隔：30 分钟
 */

import pool from '../db.js';
import { convertFromLearning, validateStrategy, QUALITY_THRESHOLDS } from '../strategy.js';

// 默认检查间隔：30 分钟
const DEFAULT_TRIGGER_INTERVAL_MS = 30 * 60 * 1000;

// 默认触发配置
const DEFAULT_CONFIG = {
  enabled: true,
  time_window_minutes: 60,
  frequency_threshold: 3,
  frequency_window_hours: 24,
  quality_threshold: 0.7,
  require_all_conditions: false,
};

/**
 * 从 brain_config 获取触发配置
 * @returns {Promise<Object>} 触发配置
 */
async function getTriggerConfig() {
  const configKeys = [
    'learning.trigger.enabled',
    'learning.trigger.time_window_minutes',
    'learning.trigger.frequency_threshold',
    'learning.trigger.frequency_window_hours',
    'learning.trigger.quality_threshold',
    'learning.trigger.require_all_conditions',
  ];

  const placeholders = configKeys.map((_, i) => `$${i + 1}`).join(', ');
  const result = await pool.query(
    `SELECT key, value FROM brain_config WHERE key IN (${placeholders})`,
    configKeys
  );

  const config = { ...DEFAULT_CONFIG };

  for (const row of result.rows) {
    switch (row.key) {
      case 'learning.trigger.enabled':
        config.enabled = row.value === 'true';
        break;
      case 'learning.trigger.time_window_minutes':
        config.time_window_minutes = parseInt(row.value, 10) || DEFAULT_CONFIG.time_window_minutes;
        break;
      case 'learning.trigger.frequency_threshold':
        config.frequency_threshold = parseInt(row.value, 10) || DEFAULT_CONFIG.frequency_threshold;
        break;
      case 'learning.trigger.frequency_window_hours':
        config.frequency_window_hours = parseInt(row.value, 10) || DEFAULT_CONFIG.frequency_window_hours;
        break;
      case 'learning.trigger.quality_threshold':
        config.quality_threshold = parseFloat(row.value) || DEFAULT_CONFIG.quality_threshold;
        break;
      case 'learning.trigger.require_all_conditions':
        config.require_all_conditions = row.value === 'true';
        break;
    }
  }

  return config;
}

/**
 * 检查触发条件是否满足
 * @param {Object} learning - Learning 记录
 * @param {Object} config - 触发配置
 * @param {Object} freqInfo - 频率信息
 * @returns {Object} { shouldTrigger: boolean, reasons: string[] }
 */
function checkTriggerConditions(learning, config, freqInfo) {
  const reasons = [];
  let timeWindowMet = false;
  let frequencyMet = false;
  let qualityMet = false;

  // 1. 检查时间窗口条件
  if (config.time_window_minutes) {
    const learningAgeMinutes = (Date.now() - new Date(learning.created_at).getTime()) / (1000 * 60);
    timeWindowMet = learningAgeMinutes <= config.time_window_minutes;
    if (timeWindowMet) {
      reasons.push(`within time window (${Math.round(learningAgeMinutes)}min <= ${config.time_window_minutes}min)`);
    }
  } else {
    timeWindowMet = true; // No time window required
  }

  // 2. 检查频率条件
  if (config.frequency_threshold && learning.trigger_event) {
    frequencyMet = freqInfo.count >= config.frequency_threshold;
    if (frequencyMet) {
      reasons.push(`frequency threshold met (${freqInfo.count} >= ${config.frequency_threshold})`);
    }
  } else {
    frequencyMet = true; // No frequency requirement
  }

  // 3. 检查质量条件
  const confidence = learning.metadata?.confidence || learning.quality_score || 0;
  qualityMet = confidence >= config.quality_threshold;
  if (qualityMet) {
    reasons.push(`quality threshold met (${confidence.toFixed(2)} >= ${config.quality_threshold})`);
  }

  // 判断是否触发
  let shouldTrigger;
  if (config.require_all_conditions) {
    shouldTrigger = timeWindowMet && frequencyMet && qualityMet;
  } else {
    // 任一条件满足即可（但质量必须满足）
    shouldTrigger = qualityMet && (timeWindowMet || frequencyMet);
  }

  return { shouldTrigger, reasons };
}

/**
 * 获取指定时间窗口内相同 trigger_event 的出现次数
 * @param {string} triggerEvent - 触发事件类型
 * @param {number} windowHours - 时间窗口（小时）
 * @returns {Promise<{count: number, event: string}>}
 */
async function getTriggerEventFrequency(triggerEvent, windowHours) {
  const result = await pool.query(
    `SELECT COUNT(*) as count FROM learnings
     WHERE trigger_event = $1
       AND created_at >= NOW() - INTERVAL '${windowHours} hours'
       AND applied = true`,
    [triggerEvent]
  );

  return {
    count: parseInt(result.rows[0].count, 10),
    event: triggerEvent,
  };
}

/**
 * 获取需要检查的 learnings（未转换为策略的、高质量的）
 * @param {number} timeWindowMinutes - 时间窗口（分钟）
 * @returns {Promise<Array>}
 */
async function getCandidateLearnings(timeWindowMinutes) {
  const result = await pool.query(
    `SELECT l.*,
            (l.metadata->>'confidence')::float as conf_score,
            l.quality_score
     FROM learnings l
     WHERE l.created_at >= NOW() - INTERVAL '${timeWindowMinutes} minutes'
       AND l.applied = true
       AND NOT EXISTS (
         SELECT 1 FROM strategies s
         WHERE s.created_from_learning_id = l.id
       )
     ORDER BY l.created_at DESC
     LIMIT 100`
  );

  return result.rows;
}

/**
 * 将策略保存到数据库
 * @param {Object} strategy - 策略对象
 * @returns {Promise<string>} 策略 ID
 */
async function saveStrategy(strategy) {
  const result = await pool.query(
    `INSERT INTO strategies (name, description, conditions, actions, version, created_from_learning_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      strategy.name,
      strategy.description,
      JSON.stringify(strategy.conditions),
      JSON.stringify(strategy.actions),
      strategy.version,
      strategy.created_from_learning_id,
      JSON.stringify(strategy.metadata || {}),
    ]
  );

  return result.rows[0].id;
}

/**
 * 更新 learning 的触发状态
 * @param {string} learningId - Learning ID
 * @param {Object} triggerInfo - 触发信息
 */
async function markLearningTriggered(learningId, triggerInfo) {
  await pool.query(
    `UPDATE learnings
     SET triggered_at = NOW(),
         trigger_source = $2,
         metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
     WHERE id = $1`,
    [
      learningId,
      triggerInfo.source,
      JSON.stringify(triggerInfo.metadata || {}),
    ]
  );
}

/**
 * 触发 Learning to Strategy 转换
 * @param {Object} options - 选项
 * @param {number} options.intervalMs - 检查间隔（毫秒）
 * @param {number} options.lastTriggerTime - 上次触发时间戳
 * @returns {Promise<{converted: Array, skipped: boolean, nextTriggerTime: number}>}
 */
async function triggerLearningToStrategy(options = {}) {
  const { intervalMs = DEFAULT_TRIGGER_INTERVAL_MS, lastTriggerTime = 0 } = options;

  const now = Date.now();
  const elapsed = now - lastTriggerTime;

  // 检查是否需要触发
  if (elapsed < intervalMs) {
    return {
      converted: [],
      skipped: true,
      nextTriggerTime: lastTriggerTime + intervalMs,
      reason: `Not time yet (elapsed: ${Math.round(elapsed / 1000)}s, interval: ${Math.round(intervalMs / 1000)}s)`,
    };
  }

  // 获取配置
  const config = await getTriggerConfig();

  if (!config.enabled) {
    console.log('[learning-strategy-trigger] Trigger disabled in config');
    return {
      converted: [],
      skipped: true,
      nextTriggerTime: now,
      reason: 'Trigger disabled',
    };
  }

  // 获取候选 learnings
  const candidateLearnings = await getCandidateLearnings(config.time_window_minutes);

  if (candidateLearnings.length === 0) {
    console.log('[learning-strategy-trigger] No candidate learnings found');
    return {
      converted: [],
      skipped: true,
      nextTriggerTime: now,
      reason: 'No candidate learnings',
    };
  }

  const converted = [];
  const errors = [];

  // 预获取所有 trigger_event 的频率信息
  const frequencyCache = {};
  for (const learning of candidateLearnings) {
    if (learning.trigger_event && !frequencyCache[learning.trigger_event]) {
      frequencyCache[learning.trigger_event] = await getTriggerEventFrequency(
        learning.trigger_event,
        config.frequency_window_hours
      );
    }
  }

  // 遍历每个 candidate learning
  for (const learning of candidateLearnings) {
    try {
      const freqInfo = learning.trigger_event
        ? frequencyCache[learning.trigger_event]
        : { count: 0, event: null };

      // 检查触发条件
      const { shouldTrigger, reasons } = checkTriggerConditions(learning, config, freqInfo);

      if (!shouldTrigger) {
        continue;
      }

      // 尝试转换为策略
      const strategy = convertFromLearning(learning);

      if (!strategy) {
        console.warn(`[learning-strategy-trigger] Learning ${learning.id} failed to convert`);
        continue;
      }

      // 验证策略
      const validation = validateStrategy(strategy);
      if (!validation.valid) {
        console.warn(`[learning-strategy-trigger] Strategy validation failed: ${validation.errors.join(', ')}`);
        continue;
      }

      // 保存策略
      const strategyId = await saveStrategy(strategy);

      // 标记 learning 已触发
      await markLearningTriggered(learning.id, {
        source: 'auto_trigger',
        metadata: {
          strategy_id: strategyId,
          conditions: reasons,
        },
      });

      console.log(`[learning-strategy-trigger] Converted learning ${learning.id} to strategy ${strategyId}: ${strategy.name}`);
      converted.push({
        learning_id: learning.id,
        strategy_id: strategyId,
        strategy_name: strategy.name,
        reasons,
      });
    } catch (err) {
      console.error(`[learning-strategy-trigger] Error processing learning ${learning.id}:`, err.message);
      errors.push({ learning_id: learning.id, error: err.message });
    }
  }

  return {
    converted,
    errors,
    skipped: false,
    nextTriggerTime: now,
    summary: converted.length > 0
      ? `Converted ${converted.length} learnings to strategies`
      : 'No learnings met trigger conditions',
  };
}

/**
 * 获取触发器状态
 * @returns {Promise<Object>}
 */
async function getTriggerStatus() {
  const config = await getTriggerConfig();

  // 获取最近转换的策略
  const recentStrategies = await pool.query(
    `SELECT s.*, l.title as learning_title
     FROM strategies s
     LEFT JOIN learnings l ON s.created_from_learning_id = l.id
     ORDER BY s.created_at DESC
     LIMIT 10`
  );

  // 获取统计信息
  const stats = await pool.query(`
    SELECT
      COUNT(*) as total_strategies,
      COUNT(DISTINCT created_from_learning_id) as unique_learnings
    FROM strategies
  `);

  return {
    config,
    recent_strategies: recentStrategies.rows,
    stats: stats.rows[0],
  };
}

/**
 * 获取 Learning-Strategy 转换统计信息
 * @returns {Promise<Object>} 统计对象
 */
async function getConversionStats() {
  // 总转换次数统计
  const totalResult = await pool.query(`
    SELECT
      COUNT(*) as total_conversions,
      COUNT(DISTINCT created_from_learning_id) as unique_learnings
    FROM strategies
    WHERE created_from_learning_id IS NOT NULL
  `);

  // 成功/失败统计（通过 learning 是否有 triggered_at 判断）
  const statusResult = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN triggered_at IS NOT NULL THEN 1 END) as triggered,
      COUNT(CASE WHEN triggered_at IS NULL THEN 1 END) as not_triggered
    FROM learnings
    WHERE applied = true
  `);

  // 平均耗时（从 learning 创建到 strategy 创建的时间差）
  const durationResult = await pool.query(`
    SELECT
      AVG(EXTRACT(EPOCH FROM (s.created_at - l.created_at)) * 1000) as avg_duration_ms
    FROM strategies s
    JOIN learnings l ON s.created_from_learning_id = l.id
  `);

  // 过去 24 小时转换次数
  const last24h = await pool.query(`
    SELECT COUNT(*) as count
    FROM strategies
    WHERE created_from_learning_id IS NOT NULL
      AND created_at >= NOW() - INTERVAL '24 hours'
  `);

  // 过去 7 天转换次数
  const last7d = await pool.query(`
    SELECT COUNT(*) as count
    FROM strategies
    WHERE created_from_learning_id IS NOT NULL
      AND created_at >= NOW() - INTERVAL '7 days'
  `);

  const total = parseInt(totalResult.rows[0].total_conversions, 10);
  const uniqueLearnings = parseInt(totalResult.rows[0].unique_learnings, 10);
  const avgDuration = durationResult.rows[0].avg_duration_ms
    ? Math.round(parseFloat(durationResult.rows[0].avg_duration_ms))
    : 0;

  // 计算成功率（基于 triggered 字段）
  const statusRow = statusResult.rows[0];
  const triggered = parseInt(statusRow.triggered, 10);
  const notTriggered = parseInt(statusRow.not_triggered, 10);
  const successRate = (triggered + notTriggered) > 0
    ? Math.round((triggered / (triggered + notTriggered)) * 10000) / 100
    : 0;

  return {
    total_conversions: total,
    unique_learnings: uniqueLearnings,
    success_count: triggered,
    failure_count: notTriggered,
    success_rate: successRate,
    avg_duration_ms: avgDuration,
    last_24h_conversions: parseInt(last24h.rows[0].count, 10),
    last_7d_conversions: parseInt(last7d.rows[0].count, 10),
  };
}

/**
 * 获取 Learning-Strategy 转换历史
 * @param {Object} options - 查询选项
 * @param {number} options.limit - 返回条数
 * @param {number} options.offset - 偏移量
 * @param {string} options.status - 筛选状态（success/failure/all）
 * @returns {Promise<Object>} 历史记录
 */
async function getConversionHistory({ limit = 20, offset = 0, status = 'all' } = {}) {
  let whereClause = 'WHERE s.created_from_learning_id IS NOT NULL';
  const params = [];

  if (status === 'success') {
    whereClause += ' AND l.triggered_at IS NOT NULL';
  } else if (status === 'failure') {
    whereClause += ' AND l.triggered_at IS NULL AND l.applied = true';
  }

  const result = await pool.query(
    `SELECT
      l.id as learning_id,
      l.title as learning_title,
      l.trigger_event,
      l.quality_score,
      l.triggered_at,
      s.id as strategy_id,
      s.name as strategy_name,
      s.version,
      s.created_at as strategy_created_at,
      EXTRACT(EPOCH FROM (s.created_at - l.created_at)) * 1000 as duration_ms,
      CASE WHEN l.triggered_at IS NOT NULL THEN 'success' ELSE 'pending' END as status
    FROM learnings l
    LEFT JOIN strategies s ON s.created_from_learning_id = l.id
    ${whereClause}
    ORDER BY COALESCE(s.created_at, l.created_at) DESC
    LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  // 获取总数
  const countResult = await pool.query(
    `SELECT COUNT(*) as total
    FROM strategies s
    JOIN learnings l ON s.created_from_learning_id = l.id
    ${whereClause.replace(/s\./g, 'l.')}`
  );

  return {
    records: result.rows.map(r => ({
      learning_id: r.learning_id,
      learning_title: r.learning_title,
      trigger_event: r.trigger_event,
      quality_score: r.quality_score,
      triggered_at: r.triggered_at,
      strategy_id: r.strategy_id,
      strategy_name: r.strategy_name,
      version: r.version,
      created_at: r.strategy_created_at,
      duration_ms: r.duration_ms ? Math.round(parseFloat(r.duration_ms)) : null,
      status: r.status,
    })),
    total: parseInt(countResult.rows[0].total, 10),
    limit,
    offset,
  };
}

/**
 * 获取转换诊断信息
 * @returns {Promise<Object>} 诊断信息
 */
async function getConversionDiagnostics() {
  // 失败的转换记录
  const failedResult = await pool.query(`
    SELECT
      l.id as learning_id,
      l.title as learning_title,
      l.trigger_event,
      l.quality_score,
      l.created_at,
      l.applied,
      l.triggered_at,
      l.metadata as learning_metadata
    FROM learnings l
    WHERE l.applied = true
      AND l.triggered_at IS NULL
      AND EXISTS (
        SELECT 1 FROM strategies s
        WHERE s.created_from_learning_id = l.id
      ) = false
    ORDER BY l.created_at DESC
    LIMIT 50
  `);

  // 待转换的 learnings（符合条件的但尚未转换）
  const pendingResult = await pool.query(`
    SELECT
      l.id as learning_id,
      l.title as learning_title,
      l.trigger_event,
      l.quality_score,
      l.created_at,
      (l.metadata->>'confidence')::float as confidence
    FROM learnings l
    WHERE l.applied = true
      AND NOT EXISTS (
        SELECT 1 FROM strategies s
        WHERE s.created_from_learning_id = l.id
      )
    ORDER BY l.quality_score DESC, l.created_at DESC
    LIMIT 20
  `);

  // 验证错误统计
  const validationErrors = await pool.query(`
    SELECT
      l.trigger_event,
      COUNT(*) as count
    FROM learnings l
    WHERE l.applied = true
      AND l.triggered_at IS NULL
      AND l.quality_score < 0.7
    GROUP BY l.trigger_event
    ORDER BY count DESC
  `);

  const config = await getTriggerConfig();

  return {
    failed_conversions: failedResult.rows.map(r => ({
      learning_id: r.learning_id,
      learning_title: r.learning_title,
      trigger_event: r.trigger_event,
      quality_score: r.quality_score,
      created_at: r.created_at,
      applied: r.applied,
      reason: r.quality_score < config.quality_threshold
        ? `quality below threshold (${r.quality_score} < ${config.quality_threshold})`
        : 'conversion not triggered',
    })),
    pending_learnings: pendingResult.rows.map(r => ({
      learning_id: r.learning_id,
      learning_title: r.learning_title,
      trigger_event: r.trigger_event,
      quality_score: r.quality_score,
      confidence: r.confidence,
      created_at: r.created_at,
    })),
    validation_errors: validationErrors.rows,
    trigger_config: config,
  };
}

export {
  triggerLearningToStrategy,
  getTriggerStatus,
  getTriggerConfig,
  checkTriggerConditions,
  getConversionStats,
  getConversionHistory,
  getConversionDiagnostics,
  DEFAULT_TRIGGER_INTERVAL_MS,
  DEFAULT_CONFIG,
};
