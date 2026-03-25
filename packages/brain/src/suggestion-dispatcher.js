/**
 * Suggestion Dispatcher - Magentic-One Step 5
 *
 * 将高分 Suggestion 转换为 suggestion_plan 任务，
 * 派给 /plan skill 无头模式进行层级识别。
 *
 * 架构规则：任务创建权统一收归丘脑（Thalamus）。
 * 本模块负责查询候选 suggestion，通过 thalamus.processEvent
 * 发送 SUGGESTION_READY 事件，由丘脑决策是否创建任务。
 */

import pool from './db.js';
import { detectDomain } from './domain-detector.js';
import { processEvent, EVENT_TYPES } from './thalamus.js';

/**
 * 将高分 pending suggestions 分派为 suggestion_plan 任务
 *
 * @param {Object} dbPool - pg Pool 实例（可注入，默认使用全局 pool）
 * @param {number} limit - 每次最多处理条数（防止洪峰）
 * @returns {number} 创建的任务数量（由丘脑决策）
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
  `, [limit * 5]); // 多取一些，丘脑去重后再限制

  if (candidateResult.rows.length === 0) {
    return 0;
  }

  // 取最多 limit 条候选（丘脑负责去重/速率限制）
  const toDispatch = candidateResult.rows.slice(0, limit);

  let created = 0;

  for (const suggestion of toDispatch) {
    try {
      // 构建任务标题和描述（保留层级识别提示文字）
      const contentPreview = typeof suggestion.content === 'string'
        ? suggestion.content.substring(0, 200)
        : JSON.stringify(suggestion.content).substring(0, 200);

      const taskTitle = `[SUGGESTION_PLAN] 层级识别：${contentPreview}`;
      const taskDescription = `[SUGGESTION_MODE]

Suggestion ID: ${suggestion.id}
Score: ${suggestion.priority_score}
Source: ${suggestion.source || 'unknown'}

内容：
${typeof suggestion.content === 'string' ? suggestion.content : JSON.stringify(suggestion.content, null, 2)}

请识别此 Suggestion 的层级（Layer 3 KR / Layer 4 Project / Layer 5 Scope / Layer 6 Initiative / Layer 7 Task/Pipeline），
找到最合适的挂载点，并调用对应的 Brain API 创建结构。`;

      const contentStr = typeof suggestion.content === 'string'
        ? suggestion.content
        : JSON.stringify(suggestion.content);
      const detected = detectDomain(contentStr);
      // confidence=0 表示无匹配关键词（detectDomain 默认返回 coding），此时不填入 domain
      const inferredDomain = detected.confidence > 0 ? detected.domain : null;
      const inferredOwnerRole = detected.confidence > 0 ? detected.owner_role : null;

      // 2. 通过丘脑 processEvent 发送 SUGGESTION_READY，由丘脑决策创建任务
      const decision = await processEvent({
        type: EVENT_TYPES.SUGGESTION_READY,
        suggestion_id: suggestion.id,
        content: suggestion.content,
        priority_score: suggestion.priority_score,
        source: suggestion.source,
        agent_id: suggestion.agent_id,
        task_title: taskTitle,
        task_description: taskDescription,
        domain: inferredDomain,
        owner_role: inferredOwnerRole,
      });

      if (decision._suggestion_dispatched) {
        console.log(`[suggestion-dispatcher] suggestion ${suggestion.id} dispatched via thalamus (score=${suggestion.priority_score})`);
        created++;
      } else {
        console.log(`[suggestion-dispatcher] suggestion ${suggestion.id} skipped by thalamus: ${decision.rationale}`);
      }
    } catch (err) {
      console.error(`[suggestion-dispatcher] Failed to dispatch suggestion ${suggestion.id}: ${err.message}`);
    }
  }

  return created;
}
