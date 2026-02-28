/**
 * Alertness Escalation - 升级机制
 *
 * 4 级响应体系：
 * - L0: 自动恢复
 * - L1: 优雅降级
 * - L2: 紧急刹车
 * - L3: 人工介入
 */

/* global console */

import pool from '../db.js';
import { emit } from '../event-bus.js';

// ============================================================
// 响应级别定义
// ============================================================

const RESPONSE_LEVELS = {
  L0: 'auto_recovery',     // 自动恢复
  L1: 'graceful_degrade',  // 优雅降级
  L2: 'emergency_brake',   // 紧急刹车
  L3: 'human_intervention' // 人工介入
};

// 响应动作定义
const RESPONSE_ACTIONS = {
  auto_recovery: {
    name: '自动恢复',
    description: '监控状态，不主动干预',
    actions: [
      { type: 'monitor', params: { interval: 60000 } },
      { type: 'collect_metrics', params: { detailed: true } }
    ]
  },

  graceful_degrade: {
    name: '优雅降级',
    description: '减少负载，延长间隔',
    actions: [
      { type: 'reduce_concurrency', params: { factor: 0.5 } },
      { type: 'increase_interval', params: { factor: 2 } },
      { type: 'pause_low_priority', params: { priorities: ['P2', 'P3'] } }
    ]
  },

  emergency_brake: {
    name: '紧急刹车',
    description: '停止非关键操作',
    actions: [
      { type: 'stop_dispatch', params: {} },
      { type: 'cancel_pending', params: { keepCritical: true } },
      { type: 'enable_safe_mode', params: {} }
    ]
  },

  human_intervention: {
    name: '人工介入',
    description: '发送告警，等待人工处理',
    actions: [
      { type: 'send_alert', params: { channels: ['slack', 'email'] } },
      { type: 'generate_report', params: { detailed: true } },
      { type: 'stop_all', params: {} }
    ]
  }
};

// ============================================================
// 升级状态管理
// ============================================================

let escalationState = {
  currentLevel: null,
  startedAt: null,
  triggeredBy: null,
  actionsExecuted: [],
  isActive: false
};

// 升级历史
const escalationHistory = [];
const MAX_HISTORY_SIZE = 50;

// ============================================================
// 升级决策
// ============================================================

/**
 * 根据 Alertness 等级和持续时间决定响应级别
 */
export async function escalateResponse(alertnessLevel, diagnosis) {
  const duration = escalationState.startedAt
    ? Date.now() - escalationState.startedAt.getTime()
    : 0;

  // 决定目标响应级别
  const targetLevel = determineResponseLevel(alertnessLevel, duration, diagnosis);

  // 如果级别变化，执行升级
  if (targetLevel !== escalationState.currentLevel) {
    await executeEscalation(targetLevel, alertnessLevel, diagnosis.summary);
  }

  return {
    level: targetLevel,
    actions: RESPONSE_ACTIONS[targetLevel]?.actions || []
  };
}

/**
 * 确定响应级别
 */
function determineResponseLevel(alertnessLevel, duration, diagnosis) {
  // PANIC 状态 - 立即 L3
  if (alertnessLevel === 4) {
    return RESPONSE_LEVELS.L3;
  }

  // ALERT 状态 (3)
  if (alertnessLevel === 3) {
    if (duration < 2 * 60 * 1000) { // < 2分钟
      return RESPONSE_LEVELS.L1; // 优雅降级
    } else {
      return RESPONSE_LEVELS.L2; // 紧急刹车
    }
  }

  // AWARE 状态 (2)
  if (alertnessLevel === 2) {
    if (duration < 5 * 60 * 1000) { // < 5分钟
      return RESPONSE_LEVELS.L0; // 自动恢复
    } else {
      return RESPONSE_LEVELS.L1; // 优雅降级
    }
  }

  // CALM/SLEEPING 状态
  return null; // 无需响应
}

/**
 * 执行升级
 */
async function executeEscalation(newLevel, alertnessLevel, reason) {
  const oldLevel = escalationState.currentLevel;

  console.log(`[Escalation] Escalating: ${oldLevel || 'none'} → ${newLevel} (Alert: ${alertnessLevel}, Reason: ${reason})`);

  // 更新状态
  escalationState.currentLevel = newLevel;
  escalationState.startedAt = new Date();
  escalationState.triggeredBy = reason;
  escalationState.actionsExecuted = [];
  escalationState.isActive = true;

  // 记录到历史
  escalationHistory.push({
    timestamp: Date.now(),
    from: oldLevel,
    to: newLevel,
    alertnessLevel,
    reason
  });

  if (escalationHistory.length > MAX_HISTORY_SIZE) {
    escalationHistory.shift();
  }

  // 发送事件
  emit('escalation:level_changed', {
    from: oldLevel,
    to: newLevel,
    reason
  });

  // 记录到数据库
  await recordEscalation(oldLevel, newLevel, reason);
}

// ============================================================
// 动作执行
// ============================================================

/**
 * 执行响应动作
 */
export async function executeResponse(response) {
  if (!response.actions) return;

  const results = [];

  for (const action of response.actions) {
    try {
      const result = await executeAction(action);
      results.push({ action: action.type, success: true, result });

      // 记录已执行的动作
      escalationState.actionsExecuted.push({
        type: action.type,
        params: action.params,
        timestamp: Date.now(),
        success: true
      });
    } catch (error) {
      console.error(`[Escalation] Action failed: ${action.type}`, error);
      results.push({ action: action.type, success: false, error: error.message });

      escalationState.actionsExecuted.push({
        type: action.type,
        params: action.params,
        timestamp: Date.now(),
        success: false,
        error: error.message
      });
    }
  }

  // 更新数据库
  await updateEscalationActions(escalationState.actionsExecuted);

  return results;
}

/**
 * 执行单个动作
 */
async function executeAction(action) {
  console.log(`[Escalation] Executing action: ${action.type}`, action.params);

  switch (action.type) {
    case 'monitor':
      return { monitoring: true, interval: action.params.interval };

    case 'collect_metrics':
      // 触发详细指标收集
      emit('escalation:collect_metrics', action.params);
      return { collecting: true };

    case 'reduce_concurrency':
      // 减少并发数
      const newConcurrency = await updateConcurrency(action.params.factor);
      return { concurrency: newConcurrency };

    case 'increase_interval':
      // 增加 Tick 间隔
      const newInterval = await updateTickInterval(action.params.factor);
      return { interval: newInterval };

    case 'pause_low_priority':
      // 暂停低优先级任务
      const paused = await pauseLowPriorityTasks(action.params.priorities);
      return { paused };

    case 'stop_dispatch':
      // 停止任务派发
      await stopDispatch();
      return { dispatching: false };

    case 'cancel_pending':
      // 取消待处理任务
      const canceled = await cancelPendingTasks(action.params.keepCritical);
      return { canceled };

    case 'enable_safe_mode':
      // 启用安全模式
      await enableSafeMode();
      return { safeMode: true };

    case 'send_alert':
      // 发送告警
      await sendAlerts(action.params.channels);
      return { alerted: action.params.channels };

    case 'generate_report':
      // 生成诊断报告
      const report = await generateDiagnosticReport(action.params.detailed);
      return { report };

    case 'stop_all':
      // 停止所有操作
      await stopAllOperations();
      return { stopped: true };

    default:
      console.warn(`[Escalation] Unknown action type: ${action.type}`);
      return null;
  }
}

// ============================================================
// 具体动作实现
// ============================================================

async function updateConcurrency(factor) {
  // 这里应该调用 executor 模块的并发控制
  // 暂时返回模拟值
  const newValue = Math.max(1, Math.floor(10 * factor));
  console.log(`[Escalation] Concurrency reduced to ${newValue}`);
  return newValue;
}

async function updateTickInterval(factor) {
  // 这里应该调用 tick 模块的间隔控制
  // 暂时返回模拟值
  const newInterval = Math.min(30 * 60 * 1000, 5 * 60 * 1000 * factor);
  console.log(`[Escalation] Tick interval increased to ${newInterval}ms`);
  return newInterval;
}

async function pauseLowPriorityTasks(priorities) {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      UPDATE tasks
      SET status = 'paused',
          updated_at = NOW()
      WHERE status IN ('queued', 'pending')
        AND priority = ANY($1)
      RETURNING id
    `, [priorities]);

    console.log(`[Escalation] Paused ${result.rowCount} low priority tasks`);
    return result.rowCount;
  } finally {
    client.release();
  }
}

async function stopDispatch() {
  // 发送事件通知 tick 模块停止派发
  emit('escalation:stop_dispatch');
  console.log('[Escalation] Task dispatch stopped');
}

async function cancelPendingTasks(keepCritical) {
  const client = await pool.connect();
  try {
    let query = `
      UPDATE tasks
      SET status = 'canceled',
          updated_at = NOW()
      WHERE status IN ('queued', 'pending')
        AND task_type NOT IN ('research', 'suggestion_plan')
    `;

    if (keepCritical) {
      query += ` AND priority != 'P0'`;
    }

    query += ` RETURNING id`;

    const result = await client.query(query);
    console.log(`[Escalation] Canceled ${result.rowCount} pending tasks`);
    return result.rowCount;
  } finally {
    client.release();
  }
}

async function enableSafeMode() {
  // 设置全局安全模式标志
  emit('escalation:safe_mode', { enabled: true });
  console.log('[Escalation] Safe mode enabled');
}

async function sendAlerts(channels) {
  for (const channel of channels) {
    try {
      if (channel === 'slack') {
        // TODO: 集成 Slack webhook
        console.log('[Escalation] Sending Slack alert...');
      } else if (channel === 'email') {
        // TODO: 集成邮件通知
        console.log('[Escalation] Sending email alert...');
      }
    } catch (error) {
      console.error(`[Escalation] Failed to send alert to ${channel}:`, error);
    }
  }
}

async function generateDiagnosticReport(detailed) {
  const report = {
    timestamp: new Date(),
    escalationLevel: escalationState.currentLevel,
    triggeredBy: escalationState.triggeredBy,
    actionsExecuted: escalationState.actionsExecuted,
    duration: escalationState.startedAt
      ? Date.now() - escalationState.startedAt.getTime()
      : 0
  };

  if (detailed) {
    // TODO: 添加更多诊断信息
    report.systemMetrics = {};
    report.recentErrors = [];
    report.taskQueue = [];
  }

  console.log('[Escalation] Diagnostic report generated');
  return report;
}

async function stopAllOperations() {
  // 停止所有操作
  emit('escalation:emergency_stop');
  console.log('[Escalation] All operations stopped');
}

// ============================================================
// 数据库操作
// ============================================================

async function recordEscalation(fromLevel, toLevel, reason) {
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO alertness_escalations (
        id, timestamp, from_level, to_level,
        trigger_reason, response_level
      ) VALUES (
        gen_random_uuid(), NOW(), $1, $2, $3, $4
      )
    `, [
      fromLevel,
      toLevel,
      reason,
      escalationState.currentLevel
    ]);
  } catch (error) {
    console.error('[Escalation] Failed to record escalation:', error);
  } finally {
    client.release();
  }
}

async function updateEscalationActions(actions) {
  const client = await pool.connect();
  try {
    // 获取最近的升级记录
    const result = await client.query(`
      SELECT id FROM alertness_escalations
      ORDER BY timestamp DESC
      LIMIT 1
    `);

    if (result.rows.length > 0) {
      await client.query(`
        UPDATE alertness_escalations
        SET actions_taken = $1
        WHERE id = $2
      `, [JSON.stringify(actions), result.rows[0].id]);
    }
  } catch (error) {
    console.error('[Escalation] Failed to update actions:', error);
  } finally {
    client.release();
  }
}

// ============================================================
// API 接口
// ============================================================

/**
 * 获取当前响应级别
 */
export function getCurrentResponseLevel() {
  return escalationState.currentLevel;
}

/**
 * 获取升级状态
 */
export function getEscalationStatus() {
  return {
    level: escalationState.currentLevel,
    isActive: escalationState.isActive,
    startedAt: escalationState.startedAt,
    triggeredBy: escalationState.triggeredBy,
    actionsExecuted: escalationState.actionsExecuted.length,
    duration: escalationState.startedAt
      ? Date.now() - escalationState.startedAt.getTime()
      : 0
  };
}

// ============================================================
// 导出
// ============================================================

export default {
  escalateResponse,
  executeResponse,
  getCurrentResponseLevel,
  getEscalationStatus
};