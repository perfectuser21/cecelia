/**
 * Suggestion Dispatcher - Magentic-One Step 5
 *
 * 将高分 Suggestion 转换为 suggestion_plan 任务，
 * 派给 /plan skill 无头模式进行层级识别。
 */

import pool from './db.js';
import { detectDomain } from './domain-detector.js';
import { processEvent as thalamusProcessEvent, EVENT_TYPES } from './thalamus.js';
import { createTask } from './actions.js';

/**
 * 将高分 pending suggestions 分派为 suggestion_plan 任务
 *
 * @param {Object} dbPool - pg Pool 实例（可注入，默认使用全局 pool）
 * @param {number} limit - 每次最多处理条数（防止洪峰）
 * @returns {number} 创建的任务数量
 */
export async function dispatchPendingSuggestions(dbPool = pool, limit = 2) {
  // 1. 查询高分 pending suggestions（priority_score≥0.68，未过期）
  const candidateResult = await dbPool.query(`
    SELECT s.id, s.content, s.priority_score, s.source, s.agent_id
    FROM suggestions s
    WHERE s.status = 'pending'
      AND s.priority_score >= 0.68
      AND (s.expires_at IS NULL OR s.expires_at > NOW())
    ORDER BY s.priority_score DESC, s.created_at ASC
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
    try {
      // 3. 推断领域信息
      const contentStr = typeof suggestion.content === 'string'
        ? suggestion.content
        : JSON.stringify(suggestion.content);
      const detected = detectDomain(contentStr);
      // confidence=0 表示无匹配关键词（detectDomain 默认返回 coding），此时不填入 domain
      const inferredDomain = detected.confidence > 0 ? detected.domain : null;
      const inferredOwnerRole = detected.confidence > 0 ? detected.owner_role : null;

      // 4. 通知丘脑（Thalamus）统一创建 suggestion_plan 任务
      // 丘脑的 SUGGESTION_READY 处理器返回 create_task 决策，保证去重/速率限制由丘脑统一管控
      const decision = await thalamusProcessEvent({
        type: EVENT_TYPES.SUGGESTION_READY,
        suggestion_id: String(suggestion.id),
        content: suggestion.content,
        priority_score: suggestion.priority_score,
        source: suggestion.source || null,
        agent_id: suggestion.agent_id || null,
        domain: inferredDomain,
        owner_role: inferredOwnerRole,
      });

      if (!decision) {
        console.warn(`[suggestion-dispatcher] Thalamus returned null decision for suggestion ${suggestion.id}, skipping`);
        continue;
      }

      // 5. 执行丘脑决策中的 create_task 动作（经由 actions.createTask，含 dedup 逻辑）
      const createAction = decision.actions?.find(a => a.type === 'create_task');
      if (!createAction) {
        console.warn(`[suggestion-dispatcher] Thalamus decision has no create_task action for suggestion ${suggestion.id}`);
        continue;
      }

      const result = await createTask(createAction.params);
      const newTaskId = result?.task?.id;

      if (!newTaskId) {
        console.warn(`[suggestion-dispatcher] createTask returned no task id for suggestion ${suggestion.id} (deduplicated=${result?.deduplicated})`);
        continue;
      }

      // 6. 更新 suggestion 状态为 in_progress（suggestion 表管理，不是任务创建权）
      await dbPool.query(
        `UPDATE suggestions SET status = 'in_progress', updated_at = NOW() WHERE id = $1`,
        [suggestion.id]
      );

      console.log(`[suggestion-dispatcher] Thalamus created suggestion_plan task ${newTaskId} for suggestion ${suggestion.id} (score=${suggestion.priority_score})`);
      created++;
    } catch (err) {
      console.error(`[suggestion-dispatcher] Failed to dispatch suggestion ${suggestion.id}: ${err.message}`);
    }
  }

  return created;
}
