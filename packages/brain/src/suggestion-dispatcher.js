/**
 * Suggestion Dispatcher - Magentic-One Step 5
 *
 * 将高分 Suggestion 转换为 suggestion_plan 任务，
 * 派给 /plan skill 无头模式进行层级识别。
 */

import pool from './db.js';

/**
 * 将高分 pending suggestions 分派为 suggestion_plan 任务
 *
 * @param {Object} dbPool - pg Pool 实例（可注入，默认使用全局 pool）
 * @param {number} limit - 每次最多处理条数（防止洪峰）
 * @returns {number} 创建的任务数量
 */
export async function dispatchPendingSuggestions(dbPool = pool, limit = 2) {
  // 1. 查询高分 pending suggestions（score≥0.7，未过期）
  const candidateResult = await dbPool.query(`
    SELECT s.id, s.content, s.score, s.source_type, s.source_id
    FROM suggestions s
    WHERE s.status = 'pending'
      AND s.score >= 0.7
      AND (s.expires_at IS NULL OR s.expires_at > NOW())
    ORDER BY s.score DESC, s.created_at ASC
    LIMIT $1
  `, [limit * 5]); // 多取一些，去重后再限制

  if (candidateResult.rows.length === 0) {
    return 0;
  }

  // 2. 去重：排除已有 queued/in_progress suggestion_plan 任务的 suggestion
  const inFlightResult = await dbPool.query(`
    SELECT (payload->>'suggestion_id')::text AS suggestion_id
    FROM tasks
    WHERE task_type = 'suggestion_plan'
      AND status IN ('queued', 'in_progress')
      AND payload->>'suggestion_id' IS NOT NULL
  `);

  const inFlightIds = new Set(inFlightResult.rows.map(r => r.suggestion_id));

  const candidates = candidateResult.rows.filter(s => !inFlightIds.has(String(s.id)));

  if (candidates.length === 0) {
    return 0;
  }

  // 取最多 limit 条
  const toDispatch = candidates.slice(0, limit);

  let created = 0;

  for (const suggestion of toDispatch) {
    const client = await dbPool.connect();
    try {
      await client.query('BEGIN');

      // 3. 创建 suggestion_plan 任务
      const contentPreview = typeof suggestion.content === 'string'
        ? suggestion.content.substring(0, 200)
        : JSON.stringify(suggestion.content).substring(0, 200);

      const taskTitle = `[SUGGESTION_PLAN] 层级识别：${contentPreview}`;
      const taskDescription = `[SUGGESTION_MODE]

Suggestion ID: ${suggestion.id}
Score: ${suggestion.score}
Source: ${suggestion.source_type || 'unknown'}

内容：
${typeof suggestion.content === 'string' ? suggestion.content : JSON.stringify(suggestion.content, null, 2)}

请识别此 Suggestion 的层级（Layer 3 KR / Layer 4 Project / Layer 5 Initiative / Layer 6 Task），
找到最合适的挂载点，并调用对应的 Brain API 创建结构。`;

      const insertResult = await client.query(`
        INSERT INTO tasks (
          title, description, task_type, status, priority,
          payload, created_at, updated_at
        )
        VALUES ($1, $2, 'suggestion_plan', 'queued', 'P2', $3, NOW(), NOW())
        RETURNING id
      `, [
        taskTitle,
        taskDescription,
        JSON.stringify({
          suggestion_id: String(suggestion.id),
          suggestion_score: suggestion.score,
          source_type: suggestion.source_type || null,
          source_id: suggestion.source_id || null,
        })
      ]);

      const newTaskId = insertResult.rows[0].id;

      // 4. 将 suggestion.status 改为 in_progress
      await client.query(
        `UPDATE suggestions SET status = 'in_progress', updated_at = NOW() WHERE id = $1`,
        [suggestion.id]
      );

      await client.query('COMMIT');

      console.log(`[suggestion-dispatcher] Created suggestion_plan task ${newTaskId} for suggestion ${suggestion.id} (score=${suggestion.score})`);
      created++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[suggestion-dispatcher] Failed to dispatch suggestion ${suggestion.id}: ${err.message}`);
    } finally {
      client.release();
    }
  }

  return created;
}
