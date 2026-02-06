/**
 * Quarantine - 隔离区
 *
 * 自我保护机制：
 * - 隔离反复失败的任务
 * - 隔离可疑/异常任务
 * - 防止污染正常队列
 * - 需要人工审核后才能释放
 *
 * 隔离原因：
 * - repeated_failure: 连续失败 N 次
 * - suspicious_input: 可疑输入（过大、异常格式）
 * - resource_hog: 资源消耗异常
 * - manual: 人工隔离
 *
 * 核心原则：宁可错杀，不可放过（保护系统稳定）
 */

/* global console */

import pool from './db.js';
import { emit } from './event-bus.js';

// ============================================================
// 配置
// ============================================================

// 失败次数阈值：超过此次数自动隔离
const FAILURE_THRESHOLD = 3;

// 任务最大 PRD 长度（字符）：超过视为可疑
const MAX_PRD_LENGTH = 50000;

// 任务最大 payload 大小（字符）：超过视为可疑
const MAX_PAYLOAD_SIZE = 100000;

// 隔离原因定义
const QUARANTINE_REASONS = {
  REPEATED_FAILURE: 'repeated_failure',
  SUSPICIOUS_INPUT: 'suspicious_input',
  RESOURCE_HOG: 'resource_hog',
  TIMEOUT_PATTERN: 'timeout_pattern',
  MANUAL: 'manual',
};

// 审核动作
const REVIEW_ACTIONS = {
  RELEASE: 'release',           // 释放回队列
  RETRY_ONCE: 'retry_once',     // 释放并重试一次
  CANCEL: 'cancel',             // 永久取消
  MODIFY_AND_RELEASE: 'modify', // 修改后释放
};

// ============================================================
// 隔离区操作
// ============================================================

/**
 * 将任务放入隔离区
 * @param {string} taskId - 任务 ID
 * @param {string} reason - 隔离原因
 * @param {Object} details - 详细信息
 * @returns {Object} - { success, task }
 */
async function quarantineTask(taskId, reason, details = {}) {
  try {
    // 获取当前任务信息
    const taskResult = await pool.query(
      'SELECT * FROM tasks WHERE id = $1',
      [taskId]
    );

    if (taskResult.rows.length === 0) {
      return { success: false, error: 'Task not found' };
    }

    const task = taskResult.rows[0];

    // 已经在隔离区的不重复处理
    if (task.status === 'quarantined') {
      return { success: true, already_quarantined: true, task };
    }

    // 更新任务状态为隔离
    const quarantineInfo = {
      quarantined_at: new Date().toISOString(),
      reason,
      details,
      previous_status: task.status,
      failure_count: task.payload?.failure_count || 0,
    };

    await pool.query(`
      UPDATE tasks
      SET status = 'quarantined',
          payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
      WHERE id = $1
    `, [taskId, JSON.stringify({ quarantine_info: quarantineInfo })]);

    // 记录事件
    await emit('task_quarantined', 'quarantine', {
      task_id: taskId,
      task_title: task.title,
      reason,
      details,
    });

    console.log(`[quarantine] Task ${taskId} quarantined: ${reason}`);

    return {
      success: true,
      task_id: taskId,
      reason,
      quarantine_info: quarantineInfo,
    };

  } catch (err) {
    console.error('[quarantine] Failed to quarantine task:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 从隔离区释放任务
 * @param {string} taskId - 任务 ID
 * @param {string} action - 审核动作
 * @param {Object} options - 选项
 * @returns {Object} - { success, task }
 */
async function releaseTask(taskId, action, options = {}) {
  try {
    const taskResult = await pool.query(
      'SELECT * FROM tasks WHERE id = $1',
      [taskId]
    );

    if (taskResult.rows.length === 0) {
      return { success: false, error: 'Task not found' };
    }

    const task = taskResult.rows[0];

    if (task.status !== 'quarantined') {
      return { success: false, error: 'Task is not in quarantine' };
    }

    const quarantineInfo = task.payload?.quarantine_info || {};
    let newStatus = 'queued';
    let newPayload = { ...task.payload };

    switch (action) {
      case REVIEW_ACTIONS.RELEASE:
        // 释放回队列
        newStatus = 'queued';
        newPayload.released_from_quarantine = {
          at: new Date().toISOString(),
          action,
          reviewer: options.reviewer || 'system',
        };
        // 重置失败计数
        newPayload.failure_count = 0;
        break;

      case REVIEW_ACTIONS.RETRY_ONCE:
        // 释放并标记只能重试一次
        newStatus = 'queued';
        newPayload.released_from_quarantine = {
          at: new Date().toISOString(),
          action,
          reviewer: options.reviewer || 'system',
        };
        newPayload.max_retries = 1;
        newPayload.failure_count = 0;
        break;

      case REVIEW_ACTIONS.CANCEL:
        // 永久取消
        newStatus = 'cancelled';
        newPayload.cancelled_from_quarantine = {
          at: new Date().toISOString(),
          action,
          reviewer: options.reviewer || 'system',
          reason: options.reason || 'Cancelled after quarantine review',
        };
        break;

      case REVIEW_ACTIONS.MODIFY_AND_RELEASE:
        // 修改后释放
        newStatus = 'queued';
        if (options.new_prd) {
          // 更新 PRD
          await pool.query(
            'UPDATE tasks SET prd_content = $2 WHERE id = $1',
            [taskId, options.new_prd]
          );
        }
        newPayload.released_from_quarantine = {
          at: new Date().toISOString(),
          action,
          reviewer: options.reviewer || 'system',
          modified: true,
        };
        newPayload.failure_count = 0;
        break;

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }

    // 清理隔离信息
    delete newPayload.quarantine_info;

    await pool.query(`
      UPDATE tasks
      SET status = $2,
          payload = $3::jsonb
      WHERE id = $1
    `, [taskId, newStatus, JSON.stringify(newPayload)]);

    // 记录事件
    await emit('task_released', 'quarantine', {
      task_id: taskId,
      task_title: task.title,
      action,
      new_status: newStatus,
    });

    console.log(`[quarantine] Task ${taskId} released: action=${action}, new_status=${newStatus}`);

    return {
      success: true,
      task_id: taskId,
      action,
      new_status: newStatus,
    };

  } catch (err) {
    console.error('[quarantine] Failed to release task:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 获取隔离区中的所有任务
 * @returns {Object[]} - 隔离中的任务列表
 */
async function getQuarantinedTasks() {
  try {
    const result = await pool.query(`
      SELECT id, title, status, priority, task_type,
             payload->>'quarantine_info' as quarantine_info,
             created_at, updated_at
      FROM tasks
      WHERE status = 'quarantined'
      ORDER BY updated_at DESC
    `);

    return result.rows.map(row => ({
      ...row,
      quarantine_info: row.quarantine_info ? JSON.parse(row.quarantine_info) : null,
    }));

  } catch (err) {
    console.error('[quarantine] Failed to get quarantined tasks:', err.message);
    return [];
  }
}

/**
 * 获取隔离区统计
 * @returns {Object} - 统计信息
 */
async function getQuarantineStats() {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE payload->>'quarantine_info'->>'reason' = 'repeated_failure') as repeated_failure,
        COUNT(*) FILTER (WHERE payload->>'quarantine_info'->>'reason' = 'suspicious_input') as suspicious_input,
        COUNT(*) FILTER (WHERE payload->>'quarantine_info'->>'reason' = 'resource_hog') as resource_hog,
        COUNT(*) FILTER (WHERE payload->>'quarantine_info'->>'reason' = 'timeout_pattern') as timeout_pattern,
        COUNT(*) FILTER (WHERE payload->>'quarantine_info'->>'reason' = 'manual') as manual
      FROM tasks
      WHERE status = 'quarantined'
    `);

    const stats = result.rows[0];
    return {
      total: parseInt(stats.total) || 0,
      by_reason: {
        repeated_failure: parseInt(stats.repeated_failure) || 0,
        suspicious_input: parseInt(stats.suspicious_input) || 0,
        resource_hog: parseInt(stats.resource_hog) || 0,
        timeout_pattern: parseInt(stats.timeout_pattern) || 0,
        manual: parseInt(stats.manual) || 0,
      },
    };

  } catch (err) {
    console.error('[quarantine] Failed to get stats:', err.message);
    return { total: 0, by_reason: {} };
  }
}

// ============================================================
// 检查逻辑
// ============================================================

/**
 * 检查任务是否应该被隔离（基于失败次数）
 * @param {Object} task - 任务对象
 * @returns {{ shouldQuarantine: boolean, reason?: string, details?: Object }}
 */
function shouldQuarantineOnFailure(task) {
  const failureCount = (task.payload?.failure_count || 0) + 1;

  if (failureCount >= FAILURE_THRESHOLD) {
    return {
      shouldQuarantine: true,
      reason: QUARANTINE_REASONS.REPEATED_FAILURE,
      details: {
        failure_count: failureCount,
        threshold: FAILURE_THRESHOLD,
        last_error: task.payload?.error_details || 'Unknown',
      },
    };
  }

  return { shouldQuarantine: false };
}

/**
 * 检查任务输入是否可疑
 * @param {Object} task - 任务对象
 * @returns {{ suspicious: boolean, reason?: string, details?: Object }}
 */
function checkSuspiciousInput(task) {
  const issues = [];

  // 检查 PRD 长度
  const prdLength = (task.prd_content || '').length;
  if (prdLength > MAX_PRD_LENGTH) {
    issues.push({
      type: 'prd_too_long',
      size: prdLength,
      max: MAX_PRD_LENGTH,
    });
  }

  // 检查 payload 大小
  const payloadSize = JSON.stringify(task.payload || {}).length;
  if (payloadSize > MAX_PAYLOAD_SIZE) {
    issues.push({
      type: 'payload_too_large',
      size: payloadSize,
      max: MAX_PAYLOAD_SIZE,
    });
  }

  // 检查是否包含可疑模式
  const content = (task.prd_content || '') + (task.description || '');
  const suspiciousPatterns = [
    /rm\s+-rf\s+\//i,
    /DROP\s+TABLE/i,
    /DELETE\s+FROM\s+\w+\s+WHERE\s+1\s*=\s*1/i,
    /;\s*--/,  // SQL 注入模式
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(content)) {
      issues.push({
        type: 'suspicious_pattern',
        pattern: pattern.toString(),
      });
    }
  }

  if (issues.length > 0) {
    return {
      suspicious: true,
      reason: QUARANTINE_REASONS.SUSPICIOUS_INPUT,
      details: { issues },
    };
  }

  return { suspicious: false };
}

/**
 * 检查任务是否有超时模式（连续超时）
 * @param {Object} task - 任务对象
 * @returns {{ hasPattern: boolean, reason?: string, details?: Object }}
 */
function checkTimeoutPattern(task) {
  const errorDetails = task.payload?.error_details;

  if (!errorDetails) {
    return { hasPattern: false };
  }

  // 检查是否连续超时
  if (errorDetails.type === 'timeout') {
    const timeoutCount = (task.payload?.timeout_count || 0) + 1;
    if (timeoutCount >= 2) {
      return {
        hasPattern: true,
        reason: QUARANTINE_REASONS.TIMEOUT_PATTERN,
        details: {
          timeout_count: timeoutCount,
          last_timeout: errorDetails,
        },
      };
    }
  }

  return { hasPattern: false };
}

/**
 * 综合检查任务是否应该被隔离
 * @param {Object} task - 任务对象
 * @param {string} context - 检查上下文 ('on_failure', 'on_create', 'on_dispatch')
 * @returns {{ shouldQuarantine: boolean, reason?: string, details?: Object }}
 */
function checkShouldQuarantine(task, context = 'on_failure') {
  // 1. 失败次数检查
  if (context === 'on_failure') {
    const failureCheck = shouldQuarantineOnFailure(task);
    if (failureCheck.shouldQuarantine) {
      return failureCheck;
    }

    // 超时模式检查
    const timeoutCheck = checkTimeoutPattern(task);
    if (timeoutCheck.hasPattern) {
      return {
        shouldQuarantine: true,
        reason: timeoutCheck.reason,
        details: timeoutCheck.details,
      };
    }
  }

  // 2. 可疑输入检查（创建和派发时）
  if (context === 'on_create' || context === 'on_dispatch') {
    const suspiciousCheck = checkSuspiciousInput(task);
    if (suspiciousCheck.suspicious) {
      return {
        shouldQuarantine: true,
        reason: suspiciousCheck.reason,
        details: suspiciousCheck.details,
      };
    }
  }

  return { shouldQuarantine: false };
}

/**
 * 处理任务失败，检查是否需要隔离
 * @param {string} taskId - 任务 ID
 * @returns {Object} - { quarantined, result }
 */
async function handleTaskFailure(taskId) {
  try {
    // 获取任务
    const taskResult = await pool.query(
      'SELECT * FROM tasks WHERE id = $1',
      [taskId]
    );

    if (taskResult.rows.length === 0) {
      return { quarantined: false, error: 'Task not found' };
    }

    const task = taskResult.rows[0];

    // 增加失败计数
    const newFailureCount = (task.payload?.failure_count || 0) + 1;
    await pool.query(`
      UPDATE tasks
      SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
      WHERE id = $1
    `, [taskId, JSON.stringify({ failure_count: newFailureCount })]);

    // 更新本地对象
    task.payload = { ...task.payload, failure_count: newFailureCount };

    // 检查是否需要隔离
    const check = checkShouldQuarantine(task, 'on_failure');

    if (check.shouldQuarantine) {
      const result = await quarantineTask(taskId, check.reason, check.details);
      return { quarantined: true, result };
    }

    return { quarantined: false, failure_count: newFailureCount };

  } catch (err) {
    console.error('[quarantine] handleTaskFailure error:', err.message);
    return { quarantined: false, error: err.message };
  }
}

// ============================================================
// Exports
// ============================================================

export {
  // 常量
  QUARANTINE_REASONS,
  REVIEW_ACTIONS,
  FAILURE_THRESHOLD,

  // 隔离操作
  quarantineTask,
  releaseTask,
  getQuarantinedTasks,
  getQuarantineStats,

  // 检查逻辑
  shouldQuarantineOnFailure,
  checkSuspiciousInput,
  checkTimeoutPattern,
  checkShouldQuarantine,
  handleTaskFailure,
};
