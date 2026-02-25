/**
 * Alertness Signal Path - 主模块
 *
 * KR4: 大脑知道自己病了
 *
 * 功能：
 * - 实时收集系统指标
 * - 自动诊断异常模式
 * - 分级响应和升级
 * - 自愈恢复策略
 */

/* global console */

import { collectMetrics, getRecentMetrics, calculateHealthScore } from './metrics.js';
import { diagnoseProblem, getAnomalyPatterns } from './diagnosis.js';
import { escalateResponse, getCurrentResponseLevel, executeResponse } from './escalation.js';
import { applySelfHealing, getRecoveryStatus, startRecovery } from './healing.js';
import pool from '../db.js';
import { emit } from '../event-bus.js';
import { publishAlertnessChanged } from '../events/taskEvents.js';

// ============================================================
// Alertness 等级定义
// ============================================================

export const ALERTNESS_LEVELS = {
  SLEEPING: 0,   // 休眠状态 - 无任务
  CALM: 1,       // 平静状态 - 正常运行
  AWARE: 2,      // 警觉状态 - 轻微异常
  ALERT: 3,      // 警报状态 - 明显异常
  PANIC: 4       // 恐慌状态 - 严重异常
};

export const LEVEL_NAMES = ['SLEEPING', 'CALM', 'AWARE', 'ALERT', 'PANIC'];

// ============================================================
// 状态管理
// ============================================================

let currentState = {
  level: ALERTNESS_LEVELS.CALM,
  levelName: 'CALM',
  startedAt: new Date(),
  reason: 'System initialized',
  metrics: null,
  diagnosis: null,
  responseLevel: null,
  isRecovering: false,
  lastEvaluation: new Date()
};

// 手动覆盖：{ level, reason, until }
let _manualOverride = null;

// 状态历史（用于趋势分析）
let stateHistory = [];
const MAX_HISTORY_SIZE = 100;

// ============================================================
// 核心评估逻辑
// ============================================================

/**
 * 评估系统健康并更新 Alertness 等级
 */
export async function evaluateAlertness() {
  try {
    // Check manual override expiration
    if (_manualOverride && Date.now() > _manualOverride.until) {
      console.log('[Alertness] Manual override expired');
      _manualOverride = null;
    }

    // If manual override is active, skip evaluation
    if (_manualOverride) {
      currentState.lastEvaluation = new Date();
      return currentState;
    }

    // 1. 收集指标
    const metrics = await collectMetrics();
    const healthScore = calculateHealthScore(metrics);

    // 2. 诊断问题
    const diagnosis = await diagnoseProblem(metrics, stateHistory);

    // 3. 确定目标等级
    const targetLevel = determineTargetLevel(healthScore, diagnosis);

    // 4. 检查状态转换规则
    const canTransition = checkTransitionRules(currentState.level, targetLevel);

    if (canTransition && targetLevel !== currentState.level) {
      await transitionToLevel(targetLevel, diagnosis.summary || 'Health score based transition');
    } else if (!canTransition && targetLevel < currentState.level) {
      // 渐进式恢复：目标被跳级规则 block 时，自动降一级
      // 例：ALERT(3)→CALM(1) 被 block → 改为 ALERT(3)→AWARE(2)
      const stepTarget = currentState.level - 1;
      if (checkTransitionRules(currentState.level, stepTarget)) {
        const stepReason = `Step recovery: ${diagnosis.summary || 'Health improved'}`;
        await transitionToLevel(stepTarget, stepReason);
      }
    }

    // 5. 执行响应动作
    if (currentState.level >= ALERTNESS_LEVELS.AWARE) {
      const response = await escalateResponse(currentState.level, diagnosis);
      if (response) {
        await executeResponse(response);
      }
    }

    // 6. 检查自愈条件
    if (currentState.level >= ALERTNESS_LEVELS.ALERT && !currentState.isRecovering) {
      const healingNeeded = await checkHealingConditions(diagnosis);
      if (healingNeeded) {
        await startRecovery(diagnosis.issues);
      }
    }

    // 更新状态
    currentState.metrics = metrics;
    currentState.diagnosis = diagnosis;
    currentState.lastEvaluation = new Date();

    // 保存到历史
    saveToHistory();

    // 持久化到数据库
    await persistMetrics(metrics);

    return currentState;

  } catch (error) {
    console.error('[Alertness] Evaluation error:', error);
    // 评估失败时提升警觉等级
    if (currentState.level < ALERTNESS_LEVELS.AWARE) {
      await transitionToLevel(ALERTNESS_LEVELS.AWARE, 'Evaluation error');
    }
    throw error;
  }
}

/**
 * 根据健康分数和诊断确定目标等级
 */
function determineTargetLevel(healthScore, diagnosis) {
  // 优先考虑诊断结果
  if (diagnosis.severity === 'critical') {
    return ALERTNESS_LEVELS.PANIC;
  }
  if (diagnosis.severity === 'high') {
    return ALERTNESS_LEVELS.ALERT;
  }
  if (diagnosis.severity === 'medium') {
    return ALERTNESS_LEVELS.AWARE;
  }

  // 基于健康分数
  if (healthScore >= 90) return ALERTNESS_LEVELS.CALM;
  if (healthScore >= 70) return ALERTNESS_LEVELS.AWARE;
  if (healthScore >= 50) return ALERTNESS_LEVELS.ALERT;
  return ALERTNESS_LEVELS.PANIC;
}

/**
 * 检查状态转换规则
 */
function checkTransitionRules(currentLevel, targetLevel) {
  const timeSinceLastChange = Date.now() - currentState.startedAt.getTime();
  const COOLDOWN_PERIOD = 60 * 1000; // 1分钟冷却期

  // 防震荡：冷却期内不允许降级
  if (targetLevel < currentLevel && timeSinceLastChange < COOLDOWN_PERIOD) {
    return false;
  }

  // PANIC 锁定期：30分钟内不能再次进入 PANIC
  if (targetLevel === ALERTNESS_LEVELS.PANIC) {
    const lastPanic = stateHistory
      .filter(s => s.level === ALERTNESS_LEVELS.PANIC)
      .sort((a, b) => b.timestamp - a.timestamp)[0];

    if (lastPanic && Date.now() - lastPanic.timestamp < 30 * 60 * 1000) {
      return false; // 在锁定期内，不能进入 PANIC
    }
  }

  // 渐进式恢复：不能跳级降低
  if (targetLevel < currentLevel && currentLevel - targetLevel > 1) {
    return false; // 只能逐级降低
  }

  // 紧急升级：可以直接跳到 PANIC
  if (targetLevel === ALERTNESS_LEVELS.PANIC && currentLevel < ALERTNESS_LEVELS.PANIC) {
    return true;
  }

  return true;
}

/**
 * 转换到新等级
 */
async function transitionToLevel(newLevel, reason) {
  const oldLevel = currentState.level;

  console.log(`[Alertness] Transitioning: ${LEVEL_NAMES[oldLevel]} → ${LEVEL_NAMES[newLevel]} (${reason})`);

  currentState.level = newLevel;
  currentState.levelName = LEVEL_NAMES[newLevel];
  currentState.startedAt = new Date();
  currentState.reason = reason;

  // 发送 event-bus 事件
  emit('alertness:level_changed', {
    from: oldLevel,
    to: newLevel,
    reason
  });

  // 广播 WebSocket 事件到前端
  publishAlertnessChanged({
    level: newLevel,
    previous: oldLevel,
    label: LEVEL_NAMES[newLevel],
    reason
  });

  // 记录到数据库
  await recordTransition(oldLevel, newLevel, reason);
}

/**
 * 检查是否需要自愈
 */
async function checkHealingConditions(diagnosis) {
  // 如果已在恢复中，不重复触发
  if (currentState.isRecovering) return false;

  // 检查是否有可自愈的问题
  const healableIssues = ['high_memory', 'zombie_processes', 'queue_overflow', 'high_error_rate'];
  return diagnosis.issues.some(issue => healableIssues.includes(issue));
}

/**
 * 保存到历史记录
 */
function saveToHistory() {
  stateHistory.push({
    timestamp: Date.now(),
    level: currentState.level,
    metrics: { ...currentState.metrics },
    diagnosis: currentState.diagnosis ? { ...currentState.diagnosis } : null
  });

  // 限制历史大小
  if (stateHistory.length > MAX_HISTORY_SIZE) {
    stateHistory.shift();
  }
}

/**
 * 持久化指标到数据库
 */
async function persistMetrics(metrics) {
  try {
    const client = await pool.connect();
    try {
      // 保存每个指标
      for (const [metricType, metricValue] of Object.entries(metrics)) {
        await client.query(`
          INSERT INTO alertness_metrics (
            id, timestamp, metric_type, metric_value,
            threshold_status, alertness_level
          ) VALUES (
            gen_random_uuid(), NOW(), $1, $2, $3, $4
          )
        `, [
          metricType,
          metricValue.value,
          metricValue.status,
          currentState.level
        ]);
      }
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[Alertness] Failed to persist metrics:', error);
  }
}

/**
 * 记录等级转换
 */
async function recordTransition(fromLevel, toLevel, reason) {
  try {
    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO alertness_escalations (
          id, timestamp, from_level, to_level,
          trigger_reason, response_level, actions_taken
        ) VALUES (
          gen_random_uuid(), NOW(), $1, $2, $3, $4, $5
        )
      `, [
        fromLevel,
        toLevel,
        reason,
        getCurrentResponseLevel(),
        JSON.stringify([])
      ]);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[Alertness] Failed to record transition:', error);
  }
}

// ============================================================
// API 接口
// ============================================================

/**
 * 获取当前 Alertness 状态
 */
export function getCurrentAlertness() {
  return {
    level: currentState.level,
    levelName: currentState.levelName,
    startedAt: currentState.startedAt,
    reason: currentState.reason,
    duration: Date.now() - currentState.startedAt.getTime(),
    isRecovering: currentState.isRecovering,
    lastEvaluation: currentState.lastEvaluation,
    override: _manualOverride
  };
}

/**
 * 获取最近指标
 */
export async function getMetrics() {
  return currentState.metrics || await collectMetrics();
}

/**
 * 获取诊断结果
 */
export function getDiagnosis() {
  return currentState.diagnosis;
}

/**
 * 获取历史趋势
 */
export async function getHistory(minutes = 60) {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT
        timestamp,
        metric_type,
        metric_value,
        threshold_status,
        alertness_level
      FROM alertness_metrics
      WHERE timestamp > NOW() - INTERVAL '%s minutes'
      ORDER BY timestamp DESC
    `, [minutes]);

    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * 手动设置 Alertness 等级（用于测试或紧急情况）
 */
export async function setManualLevel(level, reason) {
  if (!(level in ALERTNESS_LEVELS)) {
    throw new Error(`Invalid level: ${level}`);
  }

  console.log(`[Alertness] Manual override: ${LEVEL_NAMES[level]} (${reason})`);
  await transitionToLevel(level, `Manual: ${reason}`);
}

/**
 * 手动覆盖 Alertness 等级（持久化，带过期时间）
 * evaluateAlertness() 会尊重这个覆盖，不会自动改回来
 */
export async function setManualOverride(level, reason, durationMs = 30 * 60 * 1000) {
  _manualOverride = {
    level,
    reason,
    set_at: Date.now(),
    until: Date.now() + durationMs,
  };

  await transitionToLevel(level, `Manual override: ${reason}`);
  return { success: true, override: _manualOverride };
}

/**
 * 清除手动覆盖
 */
export async function clearManualOverride() {
  if (!_manualOverride) {
    return { success: false, reason: 'No override active' };
  }

  const oldOverride = _manualOverride;
  _manualOverride = null;

  // 清除后重新评估
  await evaluateAlertness();

  return { success: true, cleared: oldOverride };
}

/**
 * 获取当前手动覆盖状态
 */
export function getManualOverride() {
  return _manualOverride;
}

/**
 * 判断是否可以规划任务
 * ALERT/PANIC 状态禁止规划
 */
export function canPlan() {
  return currentState.level < ALERTNESS_LEVELS.ALERT;
}

/**
 * 判断是否可以派发任务
 */
export function canDispatch() {
  // PANIC 状态禁止派发
  if (currentState.level >= ALERTNESS_LEVELS.PANIC) return false;

  // 恢复中限制派发
  if (currentState.isRecovering) {
    const recoveryStatus = getRecoveryStatus();
    return recoveryStatus.phase >= 2; // Phase 2 以上才能派发
  }

  return true;
}

/**
 * 获取派发速率限制
 */
export function getDispatchRate() {
  switch (currentState.level) {
    case ALERTNESS_LEVELS.SLEEPING:
      return 0; // 不派发
    case ALERTNESS_LEVELS.CALM:
      return 1.0; // 100%
    case ALERTNESS_LEVELS.AWARE:
      return 0.7; // 70%
    case ALERTNESS_LEVELS.ALERT:
      return 0.3; // 30%
    case ALERTNESS_LEVELS.PANIC:
      return 0; // 停止派发
    default:
      return 0.5;
  }
}

/**
 * 初始化 Alertness 系统
 */
export async function initAlertness() {
  console.log('[Alertness] Initializing signal path...');

  // 创建数据库表（如果不存在）
  await createTablesIfNeeded();

  // 恢复上次状态
  await restoreLastState();

  // 初始评估
  await evaluateAlertness();

  console.log('[Alertness] Signal path initialized');
}

/**
 * 创建必要的数据库表
 */
async function createTablesIfNeeded() {
  const client = await pool.connect();
  try {
    // 检查表是否存在
    const checkTable = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'alertness_metrics'
      )
    `);

    if (!checkTable.rows[0].exists) {
      console.log('[Alertness] Creating database tables...');

      // 创建指标表
      await client.query(`
        CREATE TABLE alertness_metrics (
          id UUID PRIMARY KEY,
          timestamp TIMESTAMPTZ NOT NULL,
          metric_type VARCHAR(50) NOT NULL,
          metric_value NUMERIC NOT NULL,
          threshold_status VARCHAR(20),
          alertness_level INTEGER,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // 创建升级历史表
      await client.query(`
        CREATE TABLE alertness_escalations (
          id UUID PRIMARY KEY,
          timestamp TIMESTAMPTZ NOT NULL,
          from_level INTEGER NOT NULL,
          to_level INTEGER NOT NULL,
          trigger_reason TEXT,
          response_level VARCHAR(10),
          actions_taken JSONB,
          resolved_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // 创建自愈日志表
      await client.query(`
        CREATE TABLE self_healing_log (
          id UUID PRIMARY KEY,
          timestamp TIMESTAMPTZ NOT NULL,
          issue_type VARCHAR(50),
          strategy_used VARCHAR(50),
          actions_executed JSONB,
          success BOOLEAN,
          recovery_time_seconds INTEGER,
          metrics_before JSONB,
          metrics_after JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // 创建索引
      await client.query('CREATE INDEX idx_alertness_metrics_timestamp ON alertness_metrics(timestamp DESC)');
      await client.query('CREATE INDEX idx_alertness_escalations_timestamp ON alertness_escalations(timestamp DESC)');
      await client.query('CREATE INDEX idx_self_healing_log_timestamp ON self_healing_log(timestamp DESC)');

      console.log('[Alertness] Database tables created');
    }
  } finally {
    client.release();
  }
}

/**
 * 恢复上次状态
 */
async function restoreLastState() {
  const client = await pool.connect();
  try {
    // 获取最近的等级转换
    const result = await client.query(`
      SELECT to_level, trigger_reason
      FROM alertness_escalations
      ORDER BY timestamp DESC
      LIMIT 1
    `);

    if (result.rows.length > 0) {
      const { to_level, trigger_reason } = result.rows[0];
      currentState.level = to_level;
      currentState.levelName = LEVEL_NAMES[to_level];
      currentState.reason = `Restored: ${trigger_reason}`;
      console.log(`[Alertness] Restored to ${LEVEL_NAMES[to_level]}`);
    }
  } finally {
    client.release();
  }
}

// 导出所有功能
export default {
  ALERTNESS_LEVELS,
  LEVEL_NAMES,
  initAlertness,
  evaluateAlertness,
  getCurrentAlertness,
  getMetrics,
  getDiagnosis,
  getHistory,
  setManualLevel,
  setManualOverride,
  clearManualOverride,
  getManualOverride,
  canPlan,
  canDispatch,
  getDispatchRate
};