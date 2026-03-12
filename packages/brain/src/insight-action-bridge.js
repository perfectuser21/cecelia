/**
 * Insight-Action Bridge
 *
 * 将 Cortex 生成的 cortex_insight 自动转化为可执行的 dev task。
 *
 * 核心流程：
 * 1. 检测 insight 内容是否含代码修复信号
 * 2. 去重：同一 learning_id 已有 task 则跳过
 * 3. 创建 dev task，设置 source_learning_id
 * 4. 标记 learning.applied = true
 */

/* global console */

import pool from './db.js';

// 代码修复信号关键词（中英文）
export const CODE_FIX_SIGNALS = [
  // 英文
  'bug', 'fix', 'broken', 'incorrect', 'issue', 'problem', 'error',
  'fail', 'crash', 'improve', 'refactor', 'optimize', 'missing',
  'should', 'must', 'need to', 'needs to', 'wrong', 'leak',
  // 中文
  '修复', '代码', '错误', '失败', '问题', '需要', '应该', '改进',
  '优化', '重构', '缺少', '不正确', '崩溃', '漏洞', '改善',
  '观察者惰性', '没有机制', '没有自动', '无法', '缺乏',
];

/**
 * 检测 insight 内容是否含代码修复信号
 * @param {string} content
 * @returns {boolean}
 */
export function containsCodeFixSignal(content) {
  const lower = (content || '').toLowerCase();
  return CODE_FIX_SIGNALS.some(signal => lower.includes(signal.toLowerCase()));
}

/**
 * 检查同一 learning 是否已有对应 task（去重）
 * @param {string} learningId
 * @param {Object} [dbPool] - 可注入，方便测试
 * @returns {Promise<boolean>}
 */
export async function taskExistsForLearning(learningId, dbPool = pool) {
  try {
    const result = await dbPool.query(
      `SELECT id FROM tasks WHERE source_learning_id = $1 LIMIT 1`,
      [learningId]
    );
    return result.rows.length > 0;
  } catch (err) {
    console.warn(`[insight-action-bridge] dedup check failed (non-fatal): ${err.message}`);
    return false;
  }
}

/**
 * 主函数：分析 insight 并在必要时创建 dev task
 *
 * @param {string} learningId - learnings 表主键 (UUID)
 * @param {string} content    - insight 原始内容
 * @param {string} title      - insight 标题
 * @param {Object} [dbPool]   - 可注入，方便测试
 * @returns {Promise<{created: boolean, reason?: string, task_id?: string}>}
 */
export async function checkAndCreateTask(learningId, content, title, dbPool = pool) {
  // 1. 关键词检测
  if (!containsCodeFixSignal(content)) {
    return { created: false, reason: 'no_code_fix_signal' };
  }

  // 2. 去重检查
  let alreadyExists = false;
  try {
    alreadyExists = await taskExistsForLearning(learningId, dbPool);
  } catch (_err) {
    // dedup 失败时降级：跳过创建，避免重复
    console.warn(`[insight-action-bridge] dedup check error, skipping creation`);
    return { created: false, reason: 'dedup_check_failed' };
  }

  if (alreadyExists) {
    return { created: false, reason: 'task_already_exists' };
  }

  // 3. 创建 dev task
  const taskTitle = `[insight-action] ${(title || '').slice(0, 80)}`;
  const description = `自动从 Cortex Insight 生成的修复任务。\n\n来源 Insight (id: ${learningId}):\n${(content || '').slice(0, 600)}`;

  let taskId;
  try {
    const result = await dbPool.query(
      `INSERT INTO tasks (title, description, task_type, priority, status, trigger_source, source_learning_id, payload)
       VALUES ($1, $2, 'dev', 'P2', 'queued', 'insight', $3, $4)
       RETURNING id`,
      [
        taskTitle,
        description,
        learningId,
        JSON.stringify({ created_by: 'insight_action_bridge', source_learning_id: learningId }),
      ]
    );
    taskId = result.rows[0].id;
  } catch (err) {
    console.error(`[insight-action-bridge] task creation failed: ${err.message}`);
    return { created: false, reason: 'task_create_failed', error: err.message };
  }

  // 4. 标记 applied=true
  try {
    await dbPool.query(
      `UPDATE learnings SET applied = true, applied_at = NOW() WHERE id = $1`,
      [learningId]
    );
  } catch (err) {
    // 非致命：task 已创建，applied 更新失败只影响状态标记
    console.warn(`[insight-action-bridge] failed to mark applied=true for ${learningId}: ${err.message}`);
  }

  console.log(`[insight-action-bridge] created task ${taskId} from learning ${learningId}`);
  return { created: true, task_id: taskId };
}
