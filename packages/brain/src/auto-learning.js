/**
 * 自动学习回路（Auto-Learning Loop）
 *
 * 任务完成/失败时自动产生 learning，让 Cecelia 从自己的行为中学习成长
 *
 * 成本控制：
 * - 只记录有价值的 task_type (dev, feature, research)
 * - 利用 content_hash 自动去重
 * - 每日上限 50 条
 */

import crypto from 'crypto';
import pool from './db.js';

// ── 配置 ──────────────────────────────────────────────────
export const DAILY_AUTO_LEARNING_BUDGET = 50;
export const VALUABLE_TASK_TYPES = ['dev', 'feature', 'research']; // 排除 code_review 等高频低价值类型

// 运行时状态（进程内，午夜通过 hasBudget() 中日期对比自动重置）
let _autoLearningDailyCount = 0;
let _lastAutoLearningResetDate = new Date().toDateString();

// ── 测试辅助 ──────────────────────────────────────────────
export function _resetAutoLearningState() {
  _autoLearningDailyCount = 0;
  _lastAutoLearningResetDate = new Date().toDateString();
}

/**
 * 检查是否有自动学习预算
 */
function hasAutoLearningBudget() {
  const today = new Date().toDateString();

  // 午夜重置计数器
  if (today !== _lastAutoLearningResetDate) {
    _autoLearningDailyCount = 0;
    _lastAutoLearningResetDate = today;
  }

  return _autoLearningDailyCount < DAILY_AUTO_LEARNING_BUDGET;
}

/**
 * 计算内容哈希用于去重
 */
function calculateContentHash(title, content) {
  const hashInput = `${title}\n${content}`;
  return crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 16);
}

/**
 * 检查相同哈希的学习是否已存在
 */
async function isDuplicateLearning(contentHash, dbPool = pool) {
  const existing = await dbPool.query(
    'SELECT id FROM learnings WHERE content_hash = $1 AND is_latest = true LIMIT 1',
    [contentHash]
  );

  return existing.rows.length > 0;
}

/**
 * 提取 failure_class（error_type）用于聚合去重
 * 从 result 对象或内容字符串中提取标准化错误类型
 * @param {*} result - 任务执行结果
 * @returns {string|null}
 */
export function extractErrorType(result) {
  if (!result) return null;

  // 优先从结构化结果中取 failure_class
  if (typeof result === 'object') {
    if (result.failure_class) return result.failure_class.slice(0, 100);
    if (result.error_type) return result.error_type.slice(0, 100);
    // 从 stderr 或 error 中匹配常见模式
    const text = (result.error || result.stderr_tail || result.message || '').toLowerCase();
    if (text.includes('401') || text.includes('unauthorized') || text.includes('oauth')) return 'OAUTH_401';
    if (text.includes('403') || text.includes('forbidden')) return 'AUTH_403';
    if (text.includes('rate limit') || text.includes('429')) return 'RATE_LIMIT';
    if (text.includes('timeout') || text.includes('timed out')) return 'TIMEOUT';
    if (text.includes('network') || text.includes('econnrefused') || text.includes('enotfound')) return 'NETWORK_ERROR';
  }

  if (typeof result === 'string') {
    const lower = result.toLowerCase();
    if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('oauth')) return 'OAUTH_401';
    if (lower.includes('403') || lower.includes('forbidden')) return 'AUTH_403';
    if (lower.includes('rate limit') || lower.includes('429')) return 'RATE_LIMIT';
    if (lower.includes('timeout') || lower.includes('timed out')) return 'TIMEOUT';
    if (lower.includes('network') || lower.includes('econnrefused') || lower.includes('enotfound')) return 'NETWORK_ERROR';
  }

  return null;
}

/**
 * 查找 24h 内同 category + error_type 的 learning 并合并（occurrence_count +1）
 * 返回合并的记录 ID，若无匹配则返回 null
 * @param {string} category
 * @param {string} errorType
 * @param {import('pg').Pool} dbPool
 * @returns {Promise<string|null>} - 被合并的记录 ID，或 null
 */
export async function findAndMergeRecentFailureLearning(category, errorType, dbPool = pool) {
  if (!errorType) return null;

  try {
    const existing = await dbPool.query(
      `SELECT id FROM learnings
       WHERE category = $1 AND error_type = $2 AND created_at > NOW() - INTERVAL '24 hours'
       ORDER BY created_at DESC
       LIMIT 1`,
      [category, errorType]
    );

    if (existing.rows.length === 0) return null;

    const existingId = existing.rows[0].id;
    await dbPool.query(
      `UPDATE learnings
       SET occurrence_count = occurrence_count + 1, updated_at = NOW()
       WHERE id = $1`,
      [existingId]
    );

    console.log(`[auto-learning] Merged duplicate: id=${existingId} category=${category} error_type=${errorType}`);
    return existingId;
  } catch (err) {
    console.warn(`[auto-learning] findAndMergeRecentFailureLearning failed (non-fatal): ${err.message}`);
    return null;
  }
}

/**
 * 创建自动学习记录
 */
async function createAutoLearning({ title, category, content, triggerEvent, metadata, errorType }, dbPool = pool) {
  // 预算检查
  if (!hasAutoLearningBudget()) {
    console.log(`[auto-learning] Daily budget exhausted (${DAILY_AUTO_LEARNING_BUDGET}), skipping learning creation`);
    return null;
  }

  // 计算哈希并检查重复
  const contentHash = calculateContentHash(title, content);

  if (await isDuplicateLearning(contentHash, dbPool)) {
    console.log(`[auto-learning] Duplicate content detected (hash: ${contentHash}), skipping`);
    return null;
  }

  try {
    const result = await dbPool.query(`
      INSERT INTO learnings (title, category, trigger_event, content, metadata, content_hash, version, is_latest, digested, error_type, occurrence_count, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, 1, true, false, $7, 1, NOW())
      RETURNING id, title
    `, [
      title,
      category,
      triggerEvent,
      content,
      JSON.stringify(metadata || {}),
      contentHash,
      errorType || null,
    ]);

    // 更新计数器
    _autoLearningDailyCount += 1;

    const learningId = result.rows[0].id;
    console.log(`[auto-learning] Created learning: ${title} (id: ${learningId}, hash: ${contentHash})`);

    return result.rows[0];
  } catch (error) {
    console.error(`[auto-learning] Failed to create learning: ${error.message}`);
    return null;
  }
}

/**
 * 提取任务摘要
 */
function extractTaskSummary(result, maxLength = 500) {
  if (!result) return 'No details available';

  if (typeof result === 'string') {
    return result.slice(0, maxLength);
  }

  if (typeof result === 'object') {
    // 支持 cecelia-run 合成结果字段（exit_code/stderr_tail/failure_class）
    if (result.exit_code != null || result.stderr_tail || result.failure_class) {
      const parts = [];
      if (result.error) parts.push(result.error);
      if (result.failure_class) parts.push(`failure_class=${result.failure_class}`);
      if (result.exit_code != null) parts.push(`exit_code=${result.exit_code}`);
      if (result.stderr_tail) parts.push(`stderr=${result.stderr_tail.slice(0, 200)}`);
      return parts.join(' | ').slice(0, maxLength) || 'Process exited without output';
    }
    // 优先提取错误信息，再提取正常结果
    const summary = result.error_details || result.error || result.message ||
      result.result || result.findings || result.summary || JSON.stringify(result);
    return (typeof summary === 'object' ? JSON.stringify(summary) : summary.toString()).slice(0, maxLength);
  }

  return 'Unknown result format';
}

/**
 * 处理任务完成的自动学习
 */
export async function handleTaskCompletedLearning(task_id, taskType, status, result, metadata = {}) {
  // 只处理有价值的任务类型
  if (!VALUABLE_TASK_TYPES.includes(taskType)) {
    console.log(`[auto-learning] Skipping task_type=${taskType} (not in valuable list)`);
    return null;
  }

  const title = `任务完成：${task_id}`;
  const summary = extractTaskSummary(result);
  const triggerSource = metadata.trigger_source || 'execution_callback';

  const content = `任务成功完成。类型：${taskType}。触发来源：${triggerSource}。摘要：${summary}`;

  return await createAutoLearning({
    title,
    category: 'execution_result',
    content,
    triggerEvent: 'task_completed_auto',
    metadata: {
      task_id,
      task_type: taskType,
      trigger_source: triggerSource,
      auto_generated: true,
      created_at: new Date().toISOString()
    }
  });
}

/**
 * 处理任务失败的自动学习
 */
export async function handleTaskFailedLearning(task_id, taskType, status, result, retryCount = 0, metadata = {}, dbErrorMessage = null, dbPool = pool) {
  // 只处理有价值的任务类型
  if (!VALUABLE_TASK_TYPES.includes(taskType)) {
    console.log(`[auto-learning] Skipping task_type=${taskType} (not in valuable list)`);
    return null;
  }

  let errorSummary = extractTaskSummary(result);
  if (errorSummary === 'No details available' && dbErrorMessage) {
    errorSummary = dbErrorMessage.slice(0, 500);
  }

  // 提取 error_type 用于聚合去重
  const errorType = extractErrorType(result) || extractErrorType(dbErrorMessage);

  // 若 24h 内已有同类失败 learning，合并而非新增
  const mergedId = await findAndMergeRecentFailureLearning('failure_pattern', errorType, dbPool);
  if (mergedId) {
    console.log(`[auto-learning] Merged failure learning (task=${task_id}, error_type=${errorType}, merged_into=${mergedId})`);
    return { id: mergedId, merged: true };
  }

  const title = `任务失败：${errorType || task_id}`;
  const content = `任务执行失败。重试次数：${retryCount}。错误摘要：${errorSummary}`;

  return await createAutoLearning({
    title,
    category: 'failure_pattern',
    content,
    triggerEvent: 'task_failed_auto',
    errorType,
    metadata: {
      task_id,
      task_type: taskType,
      retry_count: retryCount,
      auto_generated: true,
      created_at: new Date().toISOString()
    }
  }, dbPool);
}

/**
 * 主要入口：处理任务执行结果的自动学习
 */
export async function processExecutionAutoLearning(task_id, newStatus, result, options = {}) {
  try {
    // 获取任务信息
    const taskResult = await pool.query('SELECT task_type, title, error_message FROM tasks WHERE id = $1', [task_id]);
    const taskRow = taskResult.rows[0];

    if (!taskRow) {
      console.warn(`[auto-learning] Task ${task_id} not found, skipping auto-learning`);
      return null;
    }

    const { task_type: taskType, title: taskTitle, error_message: dbErrorMessage } = taskRow;

    console.log(`[auto-learning] Processing task ${task_id} (type: ${taskType}, status: ${newStatus})`);

    const metadata = {
      trigger_source: options.trigger_source || 'execution_callback',
      task_title: taskTitle,
      ...options.metadata
    };

    if (newStatus === 'completed') {
      return await handleTaskCompletedLearning(task_id, taskType, newStatus, result, metadata);
    } else if (newStatus === 'failed') {
      const retryCount = options.retry_count || options.iterations || 0;
      return await handleTaskFailedLearning(task_id, taskType, newStatus, result, retryCount, metadata, dbErrorMessage);
    }

    console.log(`[auto-learning] Status ${newStatus} not handled for auto-learning`);
    return null;

  } catch (error) {
    console.error(`[auto-learning] Error processing auto-learning for task ${task_id}: ${error.message}`);
    return null;
  }
}

/**
 * 获取当前自动学习统计信息
 */
export function getAutoLearningStats() {
  return {
    dailyCount: _autoLearningDailyCount,
    dailyBudget: DAILY_AUTO_LEARNING_BUDGET,
    budgetRemaining: DAILY_AUTO_LEARNING_BUDGET - _autoLearningDailyCount,
    lastResetDate: _lastAutoLearningResetDate,
    valuableTaskTypes: VALUABLE_TASK_TYPES
  };
}