/**
 * Insight-to-Task 自动闭合
 *
 * cortex_insight 记录后自动检测是否涉及代码级修复，
 * 若是则生成 dev task 并标记 applied=true。
 *
 * 设计原则：
 * - 轻量关键词检测（不调 LLM），避免热路径延迟
 * - fire-and-forget 调用，不阻断主流程
 * - 去重：同 learning 已有 queued/in_progress task 则跳过
 */

/* global console */
import pool from './db.js';

// 代码修复信号关键词（中英文混合）
// 命中 ≥2 个才触发 task 创建，减少误判
const CODE_FIX_KEYWORDS = [
  // 英文
  'fix', 'bug', 'broken', 'error', 'incorrect', 'implement', 'refactor',
  'optimize', 'improve', 'issue', 'defect', 'patch', 'regression',
  // 中文
  '修复', '代码', '实现', '重构', '优化', '新增', '删除', '更新', '改善',
  '问题', '缺陷', '漏洞', '异常', '崩溃', '失败',
];

/**
 * 检测 insight 内容是否含代码修复信号
 * @param {string} content - insight 内容
 * @returns {boolean}
 */
export function hasCodeFixSignal(content) {
  if (!content || typeof content !== 'string') return false;
  const lower = content.toLowerCase();
  const matches = CODE_FIX_KEYWORDS.filter(kw => lower.includes(kw.toLowerCase()));
  return matches.length >= 2;
}

/**
 * 根据 cortex_insight learning 触发 dev task 创建
 *
 * @param {string} learningId - learnings.id
 * @param {string} title - learning 标题（如 "Cortex Insight: ..."）
 * @param {string} content - learning 内容
 * @param {import('pg').Pool} [dbPool] - 可注入 pool（测试用）
 * @returns {Promise<{created?: boolean, skipped?: boolean, reason?: string, task_id?: string}>}
 */
export async function triggerInsightTask(learningId, title, content, dbPool = pool) {
  try {
    // 1. 代码修复信号检测
    if (!hasCodeFixSignal(content)) {
      return { skipped: true, reason: 'no_code_fix_signal' };
    }

    // 2. 去重：同 learning_id 已有活跃 task 则跳过
    const dedupResult = await dbPool.query(
      `SELECT id FROM tasks
       WHERE source_learning_id = $1
         AND status IN ('queued', 'in_progress')
       LIMIT 1`,
      [learningId]
    );
    if (dedupResult.rows.length > 0) {
      console.log(`[insight-to-task] Dedup: task already exists for learning ${learningId} (task_id: ${dedupResult.rows[0].id})`);
      return { skipped: true, reason: 'task_already_exists', task_id: dedupResult.rows[0].id };
    }

    // 3. 创建 dev task
    const taskTitle = `[Insight] ${title.replace(/^Cortex Insight:\s*/i, '').slice(0, 120)}`;
    const description = `自动从 Cortex Insight 生成的修复任务。\n\n原始洞察：\n${content}`;

    const insertResult = await dbPool.query(
      `INSERT INTO tasks
         (title, description, task_type, priority, status, trigger_source, source_learning_id, payload)
       VALUES ($1, $2, 'dev', 'P2', 'queued', 'cortex_insight', $3, $4)
       RETURNING id`,
      [
        taskTitle,
        description,
        learningId,
        JSON.stringify({ source: 'insight_auto_close', learning_id: learningId }),
      ]
    );

    const taskId = insertResult.rows[0].id;
    console.log(`[insight-to-task] Created task ${taskId} from learning ${learningId}`);

    // 4. 标记 applied=true
    await dbPool.query(
      `UPDATE learnings SET applied = true, applied_at = NOW() WHERE id = $1`,
      [learningId]
    );
    console.log(`[insight-to-task] Marked learning ${learningId} as applied`);

    return { created: true, task_id: taskId };
  } catch (err) {
    console.warn(`[insight-to-task] Failed (non-fatal): ${err.message}`);
    return { skipped: true, reason: 'error', error: err.message };
  }
}
