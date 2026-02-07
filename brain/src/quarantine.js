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

// ============================================================
// 失败分类（系统性 vs 任务性）
// ============================================================

const FAILURE_CLASS = {
  BILLING_CAP: 'billing_cap',     // API 账单上限 - 等 reset 时间
  RATE_LIMIT: 'rate_limit',       // 429 限流 - 指数退避
  AUTH: 'auth',                   // 权限/认证 - 不重试，通知人
  NETWORK: 'network',             // 网络 - 短延迟重试
  RESOURCE: 'resource',           // 资源不足 - 不重试，通知人
  TASK_ERROR: 'task_error',       // 任务本身问题 - 正常失败计数
  // 向后兼容
  SYSTEMIC: 'systemic',
  TASK_SPECIFIC: 'task_specific',
  UNKNOWN: 'unknown',
};

// 失败模式分组（按 FAILURE_CLASS 细分）
const BILLING_CAP_PATTERNS = [
  /spending\s+cap/i,
  /cap\s+reached/i,
  /billing.*limit/i,
  /usage.*limit.*reached/i,
];

const RATE_LIMIT_PATTERNS = [
  /too\s+many\s+requests/i,
  /rate\s+limit/i,
  /429/,
  /overloaded/i,
  /resource\s+exhausted/i,
  /quota\s+exceeded/i,
];

const AUTH_PATTERNS = [
  /permission\s+denied|access\s+denied|unauthorized/i,
  /EACCES|EPERM/i,
  /authentication\s+failed|auth\s+error/i,
  /invalid.*api.*key/i,
  /forbidden/i,
];

const NETWORK_PATTERNS = [
  /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ENETUNREACH/i,
  /connection\s+refused|connection\s+reset/i,
  /network\s+error|socket\s+hang\s+up/i,
  /ECONNRESET/i,
  /5\d{2}\s+error|internal\s+server\s+error/i,
  /service\s+unavailable|bad\s+gateway/i,
  /upstream\s+connect\s+error/i,
  /database.*connection|pool.*exhausted/i,
  /deadlock\s+detected|lock\s+timeout/i,
];

const RESOURCE_PATTERNS = [
  /ENOMEM|out\s+of\s+memory/i,
  /disk\s+full|no\s+space\s+left/i,
  /ENOSPC/i,
  /oom/i,
];

// Legacy: combined SYSTEMIC_PATTERNS for backward compatibility
const SYSTEMIC_PATTERNS = [
  ...BILLING_CAP_PATTERNS,
  ...RATE_LIMIT_PATTERNS,
  ...AUTH_PATTERNS,
  ...NETWORK_PATTERNS,
  ...RESOURCE_PATTERNS,
];

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
        COUNT(*) FILTER (WHERE payload->'quarantine_info'->>'reason' = 'repeated_failure') as repeated_failure,
        COUNT(*) FILTER (WHERE payload->'quarantine_info'->>'reason' = 'suspicious_input') as suspicious_input,
        COUNT(*) FILTER (WHERE payload->'quarantine_info'->>'reason' = 'resource_hog') as resource_hog,
        COUNT(*) FILTER (WHERE payload->'quarantine_info'->>'reason' = 'timeout_pattern') as timeout_pattern,
        COUNT(*) FILTER (WHERE payload->'quarantine_info'->>'reason' = 'manual') as manual
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

  // 检查是否包含可疑模式（分三类）
  const content = (task.prd_content || '') + (task.description || '');

  // 1. Destructive（破坏性）：强制隔离
  const destructivePatterns = [
    { pattern: /rm\s+-rf\s+\//i, name: 'rm -rf /' },
    { pattern: /DROP\s+TABLE/i, name: 'DROP TABLE' },
    { pattern: /DROP\s+DATABASE/i, name: 'DROP DATABASE' },
    { pattern: /TRUNCATE\s+TABLE/i, name: 'TRUNCATE TABLE' },
    { pattern: /DELETE\s+FROM\s+\w+\s+WHERE\s+1\s*=\s*1/i, name: 'DELETE all rows' },
    { pattern: /mkfs\./i, name: 'mkfs (format disk)' },
    { pattern: /dd\s+if=.*of=\/dev\//i, name: 'dd to device' },
    { pattern: />\s*\/dev\/sd[a-z]/i, name: 'overwrite disk' },
  ];

  // 2. Privilege Escalation（提权/持久化）：强制隔离
  const privilegePatterns = [
    { pattern: /chmod\s+[0-7]*777/i, name: 'chmod 777' },
    { pattern: /chown\s+root/i, name: 'chown root' },
    { pattern: /visudo|\/etc\/sudoers/i, name: 'sudoers modification' },
    { pattern: /\/etc\/ssh\/sshd_config/i, name: 'SSH config modification' },
    { pattern: /authorized_keys/i, name: 'SSH keys modification' },
    { pattern: /crontab\s+-e|\/etc\/cron/i, name: 'crontab modification' },
    { pattern: /systemctl\s+(enable|disable)/i, name: 'systemd modification' },
    { pattern: /\/etc\/passwd|\/etc\/shadow/i, name: 'passwd/shadow access' },
  ];

  // 3. Data Exfiltration / Remote Execution（数据外传/远程执行）：强制隔离
  const exfiltrationPatterns = [
    { pattern: /curl\s+.*\|\s*bash/i, name: 'curl pipe to bash' },
    { pattern: /wget\s+.*\|\s*bash/i, name: 'wget pipe to bash' },
    { pattern: /base64\s+-d.*\|\s*(bash|sh)/i, name: 'base64 decode to shell' },
    { pattern: /nc\s+-e|ncat\s+-e/i, name: 'netcat reverse shell' },
    { pattern: /;\s*--/, name: 'SQL injection' },
    { pattern: /eval\s*\(\s*\$_/i, name: 'PHP eval injection' },
    { pattern: /xp_cmdshell/i, name: 'SQL Server cmdshell' },
  ];

  const allPatterns = [
    ...destructivePatterns.map(p => ({ ...p, category: 'destructive' })),
    ...privilegePatterns.map(p => ({ ...p, category: 'privilege_escalation' })),
    ...exfiltrationPatterns.map(p => ({ ...p, category: 'data_exfiltration' })),
  ];

  for (const { pattern, name, category } of allPatterns) {
    if (pattern.test(content)) {
      issues.push({
        type: 'suspicious_pattern',
        pattern: pattern.toString(),
        name,
        category,
        severity: 'critical',
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
 * 解析 reset 时间（从错误信息中提取）
 * 支持格式：
 *   "resets 11pm" → 今天 23:00 或明天 23:00（如果已过）
 *   "resets at 11:00 PM" → 同上
 *   "resets in 2 hours" → 当前时间 + 2 小时
 *
 * 所有时间使用北京时间 (UTC+8)
 * @param {string} errorStr - 错误信息
 * @returns {Date|null} - reset 时间（UTC），null 表示无法解析
 */
function parseResetTime(errorStr) {
  if (!errorStr) return null;

  // Pattern 1: "resets Xpm" or "resets X am/pm" or "resets at X:XX PM"
  const resetMatch = errorStr.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (resetMatch) {
    let hours = parseInt(resetMatch[1], 10);
    const minutes = parseInt(resetMatch[2] || '0', 10);
    const ampm = resetMatch[3].toLowerCase();

    if (ampm === 'pm' && hours !== 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;

    // 北京时间 (UTC+8)
    const now = new Date();
    const bjOffset = 8 * 60; // UTC+8 in minutes
    const utcNow = now.getTime() + now.getTimezoneOffset() * 60000;
    const bjNow = new Date(utcNow + bjOffset * 60000);

    // 构造今天的 reset 时间（北京时间）
    const resetBJ = new Date(bjNow);
    resetBJ.setHours(hours, minutes, 0, 0);

    // 如果 reset 时间已过，设为明天
    if (resetBJ <= bjNow) {
      resetBJ.setDate(resetBJ.getDate() + 1);
    }

    // 转回 UTC
    return new Date(resetBJ.getTime() - bjOffset * 60000);
  }

  // Pattern 2: "resets in X hours" or "resets in X minutes"
  const inMatch = errorStr.match(/resets?\s+in\s+(\d+)\s*(hour|minute|min|hr)/i);
  if (inMatch) {
    const amount = parseInt(inMatch[1], 10);
    const unit = inMatch[2].toLowerCase();
    const ms = unit.startsWith('hour') || unit.startsWith('hr')
      ? amount * 60 * 60 * 1000
      : amount * 60 * 1000;
    return new Date(Date.now() + ms);
  }

  // 无法解析 → 默认 2 小时后
  return new Date(Date.now() + 2 * 60 * 60 * 1000);
}

/**
 * 获取失败类别对应的重试策略
 * @param {string} failureClass - FAILURE_CLASS 值
 * @param {Object} options - { retryCount, errorStr }
 * @returns {{ should_retry: boolean, next_run_at?: string, needs_human_review?: boolean, billing_pause?: boolean, reason: string }}
 */
function getRetryStrategy(failureClass, options = {}) {
  const { retryCount = 0, errorStr = '' } = options;

  switch (failureClass) {
    case FAILURE_CLASS.BILLING_CAP: {
      const resetTime = parseResetTime(errorStr);
      return {
        should_retry: true,
        next_run_at: resetTime ? resetTime.toISOString() : new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        billing_pause: true,
        reason: `Billing cap hit, retry at reset time`,
      };
    }

    case FAILURE_CLASS.RATE_LIMIT: {
      if (retryCount >= 3) {
        return { should_retry: false, needs_human_review: true, reason: 'Rate limit retries exhausted (3/3)' };
      }
      // 指数退避: 2min → 4min → 8min
      const backoffMs = Math.pow(2, retryCount + 1) * 60 * 1000;
      return {
        should_retry: true,
        next_run_at: new Date(Date.now() + backoffMs).toISOString(),
        reason: `Rate limited, retry #${retryCount + 1} in ${backoffMs / 60000}min`,
      };
    }

    case FAILURE_CLASS.NETWORK: {
      if (retryCount >= 3) {
        return { should_retry: false, needs_human_review: true, reason: 'Network retries exhausted (3/3)' };
      }
      // 短延迟: 30s → 1min → 2min
      const backoffMs = Math.pow(2, retryCount) * 30 * 1000;
      return {
        should_retry: true,
        next_run_at: new Date(Date.now() + backoffMs).toISOString(),
        reason: `Network error, retry #${retryCount + 1} in ${backoffMs / 1000}s`,
      };
    }

    case FAILURE_CLASS.AUTH:
    case FAILURE_CLASS.RESOURCE:
      return {
        should_retry: false,
        needs_human_review: true,
        reason: `${failureClass} error - requires human intervention`,
      };

    case FAILURE_CLASS.TASK_ERROR:
    default:
      return {
        should_retry: false,
        reason: 'Task-level error, normal failure counting applies',
      };
  }
}

/**
 * 分类失败原因（6 类细分）
 * @param {string|Error} error - 错误信息
 * @param {Object} task - 任务对象（可选）
 * @returns {{ class: string, pattern?: string, confidence: number, retry_strategy?: Object }}
 */
function classifyFailure(error, task = null) {
  const errorStr = String(error?.message || error || '');

  // 按优先级检查各类模式
  const patternGroups = [
    { patterns: BILLING_CAP_PATTERNS, class: FAILURE_CLASS.BILLING_CAP },
    { patterns: RATE_LIMIT_PATTERNS, class: FAILURE_CLASS.RATE_LIMIT },
    { patterns: AUTH_PATTERNS, class: FAILURE_CLASS.AUTH },
    { patterns: RESOURCE_PATTERNS, class: FAILURE_CLASS.RESOURCE },
    { patterns: NETWORK_PATTERNS, class: FAILURE_CLASS.NETWORK },
  ];

  for (const group of patternGroups) {
    for (const pattern of group.patterns) {
      if (pattern.test(errorStr)) {
        const retryCount = task?.payload?.failure_count || 0;
        const retryStrategy = getRetryStrategy(group.class, { retryCount, errorStr });
        return {
          class: group.class,
          pattern: pattern.toString(),
          confidence: 0.9,
          retry_strategy: retryStrategy,
        };
      }
    }
  }

  // 默认为 TASK_ERROR
  return {
    class: FAILURE_CLASS.TASK_ERROR,
    pattern: null,
    confidence: 0.5,
    retry_strategy: getRetryStrategy(FAILURE_CLASS.TASK_ERROR),
  };
}

/**
 * 检查最近失败是否呈系统性模式
 * @returns {Promise<{ isSystemic: boolean, pattern?: string, count: number }>}
 */
async function checkSystemicFailurePattern() {
  try {
    // 获取最近 5 个失败任务的错误信息
    const result = await pool.query(`
      SELECT payload->>'error_details' as error_details
      FROM tasks
      WHERE status = 'failed'
        AND updated_at > NOW() - INTERVAL '30 minutes'
      ORDER BY updated_at DESC
      LIMIT 5
    `);

    if (result.rows.length < 3) {
      return { isSystemic: false, count: result.rows.length };
    }

    // 检查是否有相同的系统性错误模式
    const errors = result.rows.map(r => r.error_details || '');
    const classifications = errors.map(e => classifyFailure(e));

    const systemicCount = classifications.filter(c => c.class === FAILURE_CLASS.SYSTEMIC).length;

    if (systemicCount >= 3) {
      // 找出最常见的 pattern
      const patterns = classifications
        .filter(c => c.pattern)
        .map(c => c.pattern);
      const patternCounts = {};
      for (const p of patterns) {
        patternCounts[p] = (patternCounts[p] || 0) + 1;
      }
      const topPattern = Object.entries(patternCounts)
        .sort((a, b) => b[1] - a[1])[0];

      return {
        isSystemic: true,
        pattern: topPattern?.[0],
        count: systemicCount
      };
    }

    return { isSystemic: false, count: systemicCount };

  } catch (err) {
    console.error('[quarantine] Failed to check systemic pattern:', err.message);
    return { isSystemic: false, count: 0 };
  }
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
  FAILURE_CLASS,
  SYSTEMIC_PATTERNS,

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

  // 失败分类
  classifyFailure,
  checkSystemicFailurePattern,
  parseResetTime,
  getRetryStrategy,

  // 细分模式（测试用）
  BILLING_CAP_PATTERNS,
  RATE_LIMIT_PATTERNS,
  AUTH_PATTERNS,
  NETWORK_PATTERNS,
  RESOURCE_PATTERNS,
};
