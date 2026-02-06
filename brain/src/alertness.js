/**
 * Alertness Level - 自我保护等级系统
 *
 * 仿人脑设计：
 * - Level 0: 正常 (Normal) - 全速运行
 * - Level 1: 警觉 (Alert) - 轻微异常，减速观察
 * - Level 2: 紧急 (Emergency) - 严重异常，最小化运行
 * - Level 3: 昏迷保护 (Coma) - 停止派发，只保留心跳
 *
 * 核心原则：
 * - 纯代码实现，不依赖 LLM
 * - 多信号综合判断
 * - 自动升级/降级
 * - 支持手动覆盖
 */

/* global console */

import pool from './db.js';
import { emit } from './event-bus.js';
import { getState as getCircuitState } from './circuit-breaker.js';
import { checkServerResources, getActiveProcessCount, MAX_SEATS } from './executor.js';

// ============================================================
// Level 定义
// ============================================================

const ALERTNESS_LEVELS = {
  NORMAL: 0,      // 正常：全速运行
  ALERT: 1,       // 警觉：减速观察
  EMERGENCY: 2,   // 紧急：最小化运行
  COMA: 3,        // 昏迷：只保留心跳
};

const LEVEL_NAMES = ['NORMAL', 'ALERT', 'EMERGENCY', 'COMA'];

const LEVEL_BEHAVIORS = {
  [ALERTNESS_LEVELS.NORMAL]: {
    name: 'Normal',
    description: '正常运行，全速派发',
    dispatch_enabled: true,
    dispatch_rate: 1.0,        // 100% 派发速率
    planning_enabled: true,
    cortex_enabled: true,
    auto_retry_enabled: true,
  },
  [ALERTNESS_LEVELS.ALERT]: {
    name: 'Alert',
    description: '警觉状态，减速观察',
    dispatch_enabled: true,
    dispatch_rate: 0.5,        // 50% 派发速率
    planning_enabled: true,
    cortex_enabled: true,
    auto_retry_enabled: false, // 暂停自动重试
  },
  [ALERTNESS_LEVELS.EMERGENCY]: {
    name: 'Emergency',
    description: '紧急状态，最小化运行',
    dispatch_enabled: true,
    dispatch_rate: 0.25,       // 25% 派发速率
    planning_enabled: false,   // 暂停规划
    cortex_enabled: true,      // 保留皮层（需要分析问题）
    auto_retry_enabled: false,
  },
  [ALERTNESS_LEVELS.COMA]: {
    name: 'Coma',
    description: '昏迷保护，只保留心跳',
    dispatch_enabled: false,   // 停止派发
    dispatch_rate: 0,
    planning_enabled: false,
    cortex_enabled: false,     // 停止 LLM 调用
    auto_retry_enabled: false,
  },
};

// ============================================================
// 状态管理
// ============================================================

// 内存状态
let _currentLevel = ALERTNESS_LEVELS.NORMAL;
let _manualOverride = null;  // 手动覆盖：{ level, reason, until }
let _levelHistory = [];       // 最近 10 次级别变化
let _signals = {};            // 当前信号值

// 信号权重配置
const SIGNAL_WEIGHTS = {
  circuit_breaker_open: 30,       // 熔断器打开 → +30
  high_failure_rate: 20,          // 高失败率 → +20
  resource_pressure: 15,          // 资源压力 → +15
  consecutive_failures: 10,       // 连续失败 → +10 per failure
  db_connection_issues: 25,       // 数据库问题 → +25
  llm_api_errors: 15,             // LLM API 错误 → +15
};

// 级别阈值
const LEVEL_THRESHOLDS = {
  [ALERTNESS_LEVELS.ALERT]: 20,      // >= 20 → Alert
  [ALERTNESS_LEVELS.EMERGENCY]: 50,  // >= 50 → Emergency
  [ALERTNESS_LEVELS.COMA]: 80,       // >= 80 → Coma
};

// 冷却时间（毫秒）：升级后至少等这么久才能降级
const COOLDOWN_MS = {
  [ALERTNESS_LEVELS.ALERT]: 5 * 60 * 1000,       // 5 分钟
  [ALERTNESS_LEVELS.EMERGENCY]: 15 * 60 * 1000,  // 15 分钟
  [ALERTNESS_LEVELS.COMA]: 30 * 60 * 1000,       // 30 分钟
};

let _lastLevelChangeAt = Date.now();

// ============================================================
// 信号收集
// ============================================================

/**
 * 收集所有信号并计算综合分数
 * @returns {Object} - { signals, totalScore }
 */
async function collectSignals() {
  const signals = {};
  let totalScore = 0;

  // 1. 熔断器状态
  const cbState = getCircuitState('cecelia-run');
  if (cbState.state === 'OPEN') {
    signals.circuit_breaker_open = true;
    totalScore += SIGNAL_WEIGHTS.circuit_breaker_open;
  }

  // 2. 资源压力
  const resources = checkServerResources();
  if (resources.metrics?.max_pressure >= 0.7) {
    signals.resource_pressure = resources.metrics.max_pressure;
    totalScore += Math.round(SIGNAL_WEIGHTS.resource_pressure * resources.metrics.max_pressure);
  }

  // 3. 最近失败率（24 小时内）
  try {
    const failureResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) as total
      FROM tasks
      WHERE updated_at > NOW() - INTERVAL '24 hours'
        AND status IN ('completed', 'failed')
    `);
    const { failed, total } = failureResult.rows[0];
    if (total > 0) {
      const failureRate = parseInt(failed) / parseInt(total);
      if (failureRate > 0.3) {  // 失败率 > 30%
        signals.high_failure_rate = failureRate;
        totalScore += Math.round(SIGNAL_WEIGHTS.high_failure_rate * failureRate);
      }
    }
  } catch (err) {
    // 数据库查询失败本身就是一个信号
    signals.db_connection_issues = err.message;
    totalScore += SIGNAL_WEIGHTS.db_connection_issues;
  }

  // 4. 连续失败次数
  try {
    const consecutiveResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM (
        SELECT status, ROW_NUMBER() OVER (ORDER BY updated_at DESC) as rn
        FROM tasks
        WHERE status IN ('completed', 'failed')
        ORDER BY updated_at DESC
        LIMIT 10
      ) t
      WHERE status = 'failed' AND rn <= 5
    `);
    const consecutiveFailures = parseInt(consecutiveResult.rows[0].count);
    if (consecutiveFailures >= 3) {
      signals.consecutive_failures = consecutiveFailures;
      totalScore += SIGNAL_WEIGHTS.consecutive_failures * consecutiveFailures;
    }
  } catch {
    // ignore
  }

  // 5. 检查 LLM API 错误（从 cecelia_events 表）
  try {
    const llmErrorResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM cecelia_events
      WHERE event_type IN ('cortex_error', 'thalamus_error', 'llm_api_error')
        AND created_at > NOW() - INTERVAL '1 hour'
    `);
    const llmErrors = parseInt(llmErrorResult.rows[0].count);
    if (llmErrors >= 3) {
      signals.llm_api_errors = llmErrors;
      totalScore += SIGNAL_WEIGHTS.llm_api_errors;
    }
  } catch {
    // ignore
  }

  // 6. 检查活跃进程数是否超载
  const activeCount = getActiveProcessCount();
  if (activeCount >= MAX_SEATS) {
    signals.seats_full = activeCount;
    totalScore += 10;
  }

  _signals = signals;
  return { signals, totalScore };
}

/**
 * 根据分数计算应该的级别
 * @param {number} score
 * @returns {number} - Level
 */
function scoreToLevel(score) {
  if (score >= LEVEL_THRESHOLDS[ALERTNESS_LEVELS.COMA]) {
    return ALERTNESS_LEVELS.COMA;
  }
  if (score >= LEVEL_THRESHOLDS[ALERTNESS_LEVELS.EMERGENCY]) {
    return ALERTNESS_LEVELS.EMERGENCY;
  }
  if (score >= LEVEL_THRESHOLDS[ALERTNESS_LEVELS.ALERT]) {
    return ALERTNESS_LEVELS.ALERT;
  }
  return ALERTNESS_LEVELS.NORMAL;
}

// ============================================================
// 级别管理
// ============================================================

/**
 * 获取当前警觉级别
 * @returns {Object} - { level, name, behavior, signals, override }
 */
function getAlertness() {
  return {
    level: _currentLevel,
    name: LEVEL_NAMES[_currentLevel],
    behavior: LEVEL_BEHAVIORS[_currentLevel],
    signals: _signals,
    override: _manualOverride,
    last_change_at: _lastLevelChangeAt,
    history: _levelHistory.slice(-5),
  };
}

/**
 * 更新警觉级别
 * @param {number} newLevel
 * @param {string} reason
 * @param {boolean} isManual
 */
async function setLevel(newLevel, reason, isManual = false) {
  const oldLevel = _currentLevel;

  if (oldLevel === newLevel) {
    return { changed: false, level: newLevel };
  }

  // 检查冷却时间（只在降级时检查）
  if (newLevel < oldLevel && !isManual) {
    const cooldown = COOLDOWN_MS[oldLevel] || 0;
    const elapsed = Date.now() - _lastLevelChangeAt;
    if (elapsed < cooldown) {
      console.log(`[alertness] Cooldown active, cannot downgrade from ${LEVEL_NAMES[oldLevel]} yet (${Math.round((cooldown - elapsed) / 1000)}s remaining)`);
      return { changed: false, level: oldLevel, cooldown_remaining: cooldown - elapsed };
    }
  }

  _currentLevel = newLevel;
  _lastLevelChangeAt = Date.now();

  // 记录历史
  _levelHistory.push({
    from: oldLevel,
    to: newLevel,
    reason,
    is_manual: isManual,
    timestamp: new Date().toISOString(),
  });
  if (_levelHistory.length > 10) {
    _levelHistory.shift();
  }

  // 记录到数据库
  try {
    await pool.query(`
      INSERT INTO cecelia_events (event_type, source, payload)
      VALUES ('alertness_change', 'alertness', $1)
    `, [JSON.stringify({
      from: { level: oldLevel, name: LEVEL_NAMES[oldLevel] },
      to: { level: newLevel, name: LEVEL_NAMES[newLevel] },
      reason,
      is_manual: isManual,
      signals: _signals,
    })]);

    await emit('alertness_change', 'alertness', {
      from: oldLevel,
      to: newLevel,
      reason,
    });
  } catch (err) {
    console.error('[alertness] Failed to log level change:', err.message);
  }

  console.log(`[alertness] Level changed: ${LEVEL_NAMES[oldLevel]} → ${LEVEL_NAMES[newLevel]} (${reason})`);

  return { changed: true, from: oldLevel, to: newLevel, reason };
}

/**
 * 手动覆盖警觉级别
 * @param {number} level
 * @param {string} reason
 * @param {number} durationMs - 覆盖持续时间（毫秒）
 */
async function setManualOverride(level, reason, durationMs = 30 * 60 * 1000) {
  _manualOverride = {
    level,
    reason,
    set_at: Date.now(),
    until: Date.now() + durationMs,
  };

  await setLevel(level, `Manual override: ${reason}`, true);

  return { success: true, override: _manualOverride };
}

/**
 * 清除手动覆盖
 */
async function clearManualOverride() {
  if (!_manualOverride) {
    return { success: false, reason: 'No override active' };
  }

  const oldOverride = _manualOverride;
  _manualOverride = null;

  // 重新评估级别
  await evaluateAndUpdate();

  return { success: true, cleared: oldOverride };
}

/**
 * 评估当前状态并更新级别
 */
async function evaluateAndUpdate() {
  // 检查手动覆盖是否过期
  if (_manualOverride && Date.now() > _manualOverride.until) {
    console.log('[alertness] Manual override expired');
    _manualOverride = null;
  }

  // 如果有手动覆盖且未过期，不自动更新
  if (_manualOverride) {
    return { level: _currentLevel, source: 'manual_override' };
  }

  // 收集信号
  const { signals, totalScore } = await collectSignals();

  // 计算目标级别
  const targetLevel = scoreToLevel(totalScore);

  // 更新级别
  if (targetLevel !== _currentLevel) {
    const direction = targetLevel > _currentLevel ? 'escalate' : 'de-escalate';
    await setLevel(targetLevel, `Auto ${direction}: score=${totalScore}`);
  }

  return {
    level: _currentLevel,
    score: totalScore,
    signals,
    source: 'auto',
  };
}

// ============================================================
// 行为查询
// ============================================================

/**
 * 检查是否允许派发任务
 * @returns {boolean}
 */
function canDispatch() {
  return LEVEL_BEHAVIORS[_currentLevel].dispatch_enabled;
}

/**
 * 获取派发速率
 * @returns {number} - 0.0 ~ 1.0
 */
function getDispatchRate() {
  return LEVEL_BEHAVIORS[_currentLevel].dispatch_rate;
}

/**
 * 检查是否允许规划
 * @returns {boolean}
 */
function canPlan() {
  return LEVEL_BEHAVIORS[_currentLevel].planning_enabled;
}

/**
 * 检查是否允许调用皮层
 * @returns {boolean}
 */
function canUseCortex() {
  return LEVEL_BEHAVIORS[_currentLevel].cortex_enabled;
}

/**
 * 检查是否允许自动重试
 * @returns {boolean}
 */
function canAutoRetry() {
  return LEVEL_BEHAVIORS[_currentLevel].auto_retry_enabled;
}

/**
 * 获取当前行为配置
 * @returns {Object}
 */
function getBehavior() {
  return LEVEL_BEHAVIORS[_currentLevel];
}

// ============================================================
// 初始化
// ============================================================

/**
 * 初始化警觉系统（启动时调用）
 */
async function initAlertness() {
  console.log('[alertness] Initializing alertness system...');

  // 从数据库恢复上次状态
  try {
    const result = await pool.query(`
      SELECT payload FROM cecelia_events
      WHERE event_type = 'alertness_change'
      ORDER BY created_at DESC
      LIMIT 1
    `);

    if (result.rows.length > 0) {
      const lastChange = result.rows[0].payload;
      _currentLevel = lastChange.to?.level ?? ALERTNESS_LEVELS.NORMAL;
      console.log(`[alertness] Restored level from DB: ${LEVEL_NAMES[_currentLevel]}`);
    }
  } catch (err) {
    console.error('[alertness] Failed to restore state:', err.message);
  }

  // 立即评估当前状态
  await evaluateAndUpdate();

  console.log(`[alertness] Initialized at level: ${LEVEL_NAMES[_currentLevel]}`);
}

// ============================================================
// Exports
// ============================================================

export {
  // 常量
  ALERTNESS_LEVELS,
  LEVEL_NAMES,
  LEVEL_BEHAVIORS,

  // 状态查询
  getAlertness,
  getBehavior,

  // 行为查询
  canDispatch,
  getDispatchRate,
  canPlan,
  canUseCortex,
  canAutoRetry,

  // 级别管理
  setLevel,
  setManualOverride,
  clearManualOverride,
  evaluateAndUpdate,

  // 初始化
  initAlertness,

  // 信号收集（测试用）
  collectSignals,
  scoreToLevel,
};
