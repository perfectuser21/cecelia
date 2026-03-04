/**
 * Task Retry Service
 *
 * 提供 dev 任务执行状态监控与自动重试功能：
 * 1. recordExecutionPhase - 记录执行阶段到 payload.execution_phases
 * 2. diagnoseFailure - 失败诊断，分类为 transient（可重试）或 permanent（不可重试）
 * 3. shouldRetry - 判断任务是否应该重试
 * 4. retryTask - 执行重试逻辑
 */

import pool from './db.js';

// ============================================================
// 常量定义
// ============================================================

/**
 * 执行阶段定义（dev 任务的 5 个关键阶段）
 */
export const EXECUTION_PHASES = {
  PRD_GENERATION: 'prd_generation',
  CODE_WRITING: 'code_writing',
  PR_CREATION: 'pr_creation',
  CI_CHECK: 'ci_check',
  MERGE: 'merge',
};

/**
 * 失败类型分类
 */
export const FAILURE_TYPES = {
  TRANSIENT: 'transient',   // 暂时性失败，可重试（网络、超时等）
  PERMANENT: 'permanent',   // 永久性失败，不可重试（PRD 不合规、权限配置错误等）
};

/**
 * 常见失败模式匹配规则
 * 按顺序匹配，第一个匹配的规则生效
 */
const FAILURE_PATTERNS = [
  // ── 可重试（transient）────────────────────────────────────
  {
    pattern: /ci.*(timeout|timed out|time.?out)/i,
    type: FAILURE_TYPES.TRANSIENT,
    reason: 'CI 超时',
    retryable: true,
  },
  {
    pattern: /network.*(error|failure|unreachable)/i,
    type: FAILURE_TYPES.TRANSIENT,
    reason: '网络错误',
    retryable: true,
  },
  {
    pattern: /rate.?limit/i,
    type: FAILURE_TYPES.TRANSIENT,
    reason: 'API 限流',
    retryable: true,
  },
  {
    pattern: /connection.*(refused|reset|timeout)/i,
    type: FAILURE_TYPES.TRANSIENT,
    reason: '连接失败',
    retryable: true,
  },
  {
    pattern: /econnrefused|econnreset|etimedout/i,
    type: FAILURE_TYPES.TRANSIENT,
    reason: '连接失败（系统错误）',
    retryable: true,
  },
  {
    pattern: /server.*(error|unavailable)|503|502|504/i,
    type: FAILURE_TYPES.TRANSIENT,
    reason: '服务器暂时不可用',
    retryable: true,
  },
  {
    pattern: /merge.?conflict/i,
    type: FAILURE_TYPES.TRANSIENT,
    reason: 'Merge 冲突（可通过 rebase 解决）',
    retryable: true,
  },
  {
    pattern: /out.?of.?memory|oom/i,
    type: FAILURE_TYPES.TRANSIENT,
    reason: '内存不足（暂时性）',
    retryable: true,
  },

  // ── 不可重试（permanent）──────────────────────────────────
  {
    pattern: /prd.*(invalid|missing|not.?found|不合规)/i,
    type: FAILURE_TYPES.PERMANENT,
    reason: 'PRD 不合规或缺失',
    retryable: false,
  },
  {
    pattern: /permission.?denied|access.?denied|forbidden|unauthorized/i,
    type: FAILURE_TYPES.PERMANENT,
    reason: '权限拒绝（配置问题）',
    retryable: false,
  },
  {
    pattern: /syntax.?error|parse.?error/i,
    type: FAILURE_TYPES.PERMANENT,
    reason: '语法或解析错误',
    retryable: false,
  },
  {
    pattern: /invalid.?(task|config|schema)/i,
    type: FAILURE_TYPES.PERMANENT,
    reason: '任务或配置无效',
    retryable: false,
  },
];

// ============================================================
// 核心函数
// ============================================================

/**
 * 记录执行阶段到 payload.execution_phases
 *
 * @param {string} taskId - 任务 ID
 * @param {string} phase - 阶段名（使用 EXECUTION_PHASES 常量）
 * @param {'success'|'failed'|'timeout'|'in_progress'} status - 阶段状态
 * @param {Object} extra - 额外信息（error、pr_url 等）
 * @returns {Promise<{success: boolean, phase?: Object, error?: string}>}
 */
export async function recordExecutionPhase(taskId, phase, status, extra = {}) {
  try {
    if (!taskId) throw new Error('taskId is required');
    if (!phase) throw new Error('phase is required');

    const validStatuses = ['success', 'failed', 'timeout', 'in_progress'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid phase status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
    }

    const phaseEntry = {
      phase,
      status,
      timestamp: new Date().toISOString(),
      ...extra,
    };

    // 如果是 in_progress，记录开始时间
    if (status === 'in_progress') {
      phaseEntry.started_at = phaseEntry.timestamp;
    }

    // 如果是终态（success/failed/timeout），记录结束时间
    if (['success', 'failed', 'timeout'].includes(status)) {
      phaseEntry.ended_at = phaseEntry.timestamp;
    }

    // 使用 jsonb_build_object 将阶段追加到数组
    const result = await pool.query(`
      UPDATE tasks
      SET
        payload = COALESCE(payload, '{}'::jsonb) ||
          jsonb_build_object(
            'execution_phases',
            COALESCE(
              (payload->'execution_phases'),
              '[]'::jsonb
            ) || $2::jsonb
          ),
        updated_at = NOW()
      WHERE id = $1
      RETURNING id, payload->'execution_phases' AS execution_phases
    `, [taskId, JSON.stringify([phaseEntry])]);

    if (result.rows.length === 0) {
      throw new Error(`Task ${taskId} not found`);
    }

    return { success: true, phase: phaseEntry };
  } catch (err) {
    console.error(`[task-retry] recordExecutionPhase failed for task ${taskId}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 诊断失败原因，返回失败类型和是否可重试
 *
 * @param {string} errorMsg - 错误消息
 * @returns {{type: string, reason: string, retryable: boolean}}
 */
export function diagnoseFailure(errorMsg) {
  if (!errorMsg || typeof errorMsg !== 'string') {
    return {
      type: FAILURE_TYPES.TRANSIENT,
      reason: '未知错误（保守判断为可重试）',
      retryable: true,
    };
  }

  // 按顺序匹配失败模式
  for (const pattern of FAILURE_PATTERNS) {
    if (pattern.pattern.test(errorMsg)) {
      return {
        type: pattern.type,
        reason: pattern.reason,
        retryable: pattern.retryable,
      };
    }
  }

  // 默认：未匹配到任何模式，保守判断为可重试
  return {
    type: FAILURE_TYPES.TRANSIENT,
    reason: '未分类错误（保守判断为可重试）',
    retryable: true,
  };
}

/**
 * 判断任务是否应该重试
 *
 * @param {Object} task - 任务对象（来自数据库）
 * @returns {{shouldRetry: boolean, reason: string}}
 */
export function shouldRetry(task) {
  if (!task) {
    return { shouldRetry: false, reason: '任务不存在' };
  }

  // 1. 检查状态：只有 failed 的任务才能重试
  if (task.status !== 'failed') {
    return { shouldRetry: false, reason: `任务状态为 ${task.status}，只有 failed 状态可重试` };
  }

  // 2. 检查重试次数
  const retryCount = task.retry_count || 0;
  const maxRetries = task.max_retries != null ? task.max_retries : 3;

  if (retryCount >= maxRetries) {
    return {
      shouldRetry: false,
      reason: `已达到最大重试次数 ${maxRetries}（当前: ${retryCount}）`,
    };
  }

  // 3. 检查失败诊断：如果有 last_error 记录且标记为 permanent，不重试
  const payload = task.payload || {};
  const lastError = payload.last_error;

  if (lastError && lastError.type === FAILURE_TYPES.PERMANENT) {
    return {
      shouldRetry: false,
      reason: `失败类型为 permanent（${lastError.reason || '永久性错误'}），不可重试`,
    };
  }

  // 通过所有检查，可以重试
  return {
    shouldRetry: true,
    reason: `符合重试条件（第 ${retryCount + 1}/${maxRetries} 次重试）`,
  };
}

/**
 * 执行任务重试
 * - 更新 retry_count
 * - 记录重试历史到 payload.retry_history
 * - 将任务状态重置为 queued
 * - 记录 last_error
 *
 * @param {string} taskId - 任务 ID
 * @param {string} reason - 重试原因（错误消息）
 * @returns {Promise<{success: boolean, task?: Object, error?: string}>}
 */
export async function retryTask(taskId, reason = '') {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. 读取当前任务状态（加锁）
    const taskResult = await client.query(
      'SELECT * FROM tasks WHERE id = $1 FOR UPDATE',
      [taskId]
    );

    if (taskResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: `Task ${taskId} not found` };
    }

    const task = taskResult.rows[0];

    // 2. 检查是否可以重试
    const retryCheck = shouldRetry(task);
    if (!retryCheck.shouldRetry) {
      await client.query('ROLLBACK');
      return { success: false, error: retryCheck.reason };
    }

    // 3. 诊断失败类型
    const diagnosis = diagnoseFailure(reason);

    // 4. 构建重试历史记录
    const payload = task.payload || {};
    const existingHistory = payload.retry_history || [];
    const newRetryRecord = {
      attempt: (task.retry_count || 0) + 1,
      reason: reason || '手动触发重试',
      failure_type: diagnosis.type,
      failure_reason: diagnosis.reason,
      retried_at: new Date().toISOString(),
    };

    // 5. 构建更新后的 payload
    const updatedPayload = {
      ...payload,
      retry_history: [...existingHistory, newRetryRecord],
      last_error: {
        message: reason || '未知错误',
        type: diagnosis.type,
        reason: diagnosis.reason,
        attempt: (task.retry_count || 0) + 1,
        timestamp: new Date().toISOString(),
      },
    };

    // 6. 原子更新：重置状态 + 增加 retry_count + 更新 payload
    const updateResult = await client.query(`
      UPDATE tasks
      SET
        status = 'queued',
        retry_count = COALESCE(retry_count, 0) + 1,
        payload = $2::jsonb,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [taskId, JSON.stringify(updatedPayload)]);

    await client.query('COMMIT');

    const updatedTask = updateResult.rows[0];
    console.log(`[task-retry] Task ${taskId} re-queued (attempt ${updatedTask.retry_count}/${updatedTask.max_retries})`);

    return { success: true, task: updatedTask };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`[task-retry] retryTask failed for task ${taskId}:`, err.message);
    return { success: false, error: err.message };
  } finally {
    client.release();
  }
}

/**
 * 获取任务的完整执行状态
 *
 * @param {string} taskId - 任务 ID
 * @returns {Promise<{success: boolean, execution_status?: Object, error?: string}>}
 */
export async function getExecutionStatus(taskId) {
  try {
    const result = await pool.query(
      'SELECT id, title, status, retry_count, max_retries, payload, created_at, updated_at FROM tasks WHERE id = $1',
      [taskId]
    );

    if (result.rows.length === 0) {
      return { success: false, error: `Task ${taskId} not found` };
    }

    const task = result.rows[0];
    const payload = task.payload || {};

    return {
      success: true,
      execution_status: {
        task_id: task.id,
        title: task.title,
        status: task.status,
        retry_count: task.retry_count || 0,
        max_retries: task.max_retries != null ? task.max_retries : 3,
        execution_phases: payload.execution_phases || [],
        retry_history: payload.retry_history || [],
        last_error: payload.last_error || null,
        created_at: task.created_at,
        updated_at: task.updated_at,
      },
    };
  } catch (err) {
    console.error(`[task-retry] getExecutionStatus failed for task ${taskId}:`, err.message);
    return { success: false, error: err.message };
  }
}
