/**
 * Cecelia 欲望系统（Desire System）- 主入口
 *
 * 六层主动意识架构：
 *   Layer 1 感知层（Perception）：收集系统信号
 *   Layer 2 记忆层（Memory）：打分 + 写入 memory_stream + 累积 accumulator
 *   Layer 3 反思层（Reflection）：accumulator >= 30 时生成洞察
 *   Layer 4 欲望形成层（Desire Formation）：基于洞察生成 desires
 *   Layer 5 表达决策层（Expression Decision）：评分 > 0.6 才表达
 *   Layer 6 表达层（Expression）：发送 Feishu + 记录 last_feishu_at
 *
 * 在 tick.js executeTick() 末尾调用，try/catch 隔离，不影响主 tick。
 */

import { runPerception } from './perception.js';
import { runMemory } from './memory.js';
import { runReflection } from './reflection.js';
import { runDesireFormation } from './desire-formation.js';
import { runExpressionDecision } from './expression-decision.js';
import { runExpression } from './expression.js';
import { createSuggestion } from '../suggestion-triage.js';
import { runEmotionLayer } from '../emotion-layer.js';

/**
 * 运行完整欲望系统（六层）
 * @param {import('pg').Pool} pool
 * @returns {Promise<{
 *   perception: {observations: number},
 *   memory: {written: number, total_importance: number},
 *   reflection: {triggered: boolean, accumulator?: number},
 *   desire_formed: boolean,
 *   expression: {triggered: boolean, sent?: boolean} | null
 * }>}
 */
export async function runDesireSystem(pool) {
  const result = {
    perception: { observations: 0 },
    memory: { written: 0, total_importance: 0 },
    reflection: { triggered: false },
    desire_formed: false,
    expression: null
  };

  // Layer 1: 感知
  let observations = [];
  try {
    observations = await runPerception(pool);
    result.perception.observations = observations.length;
  } catch (err) {
    console.error('[desire] perception error:', err.message);
  }

  // Layer 1.5: 情绪层（从感知信号有机推导情绪状态）
  if (observations.length > 0) {
    try {
      await runEmotionLayer(observations, pool);
    } catch (err) {
      console.warn('[desire] emotion layer error (non-critical):', err.message);
    }
  }

  // Layer 2: 记忆（打分 + 写入 + 累积）
  if (observations.length > 0) {
    try {
      result.memory = await runMemory(pool, observations);
    } catch (err) {
      console.error('[desire] memory error:', err.message);
    }
  }

  // Layer 3: 反思（条件触发）
  let insight = null;
  try {
    const reflectionResult = await runReflection(pool);
    result.reflection = reflectionResult;
    if (reflectionResult.triggered && reflectionResult.insight) {
      insight = reflectionResult.insight;
    }
  } catch (err) {
    console.error('[desire] reflection error:', err.message);
  }

  // Layer 4: 欲望形成（仅在反思触发后）
  if (insight) {
    try {
      const formationResult = await runDesireFormation(pool, insight);
      result.desire_formed = formationResult.created;
    } catch (err) {
      console.error('[desire] desire formation error:', err.message);
    }
  }

  // Layer 5: 表达决策（每次 tick 都扫描）
  let expressionCandidate = null;
  try {
    expressionCandidate = await runExpressionDecision(pool);
  } catch (err) {
    console.error('[desire] expression decision error:', err.message);
  }

  // 环2：explore desire → 自主学习（好奇心驱动的 research 任务）
  if (expressionCandidate && expressionCandidate.desire.type === 'explore') {
    const desire = expressionCandidate.desire;
    result.expression = { triggered: true, acted: true };

    try {
      const { rows } = await pool.query(`
        INSERT INTO tasks (title, description, priority, task_type, status, trigger_source)
        VALUES ($1, $2, 'P2', 'research', 'queued', 'curiosity')
        RETURNING id
      `, [
        `[自主探索] ${desire.content.slice(0, 80)}`,
        `${desire.proposed_action || desire.content}\n\n来源：好奇心信号 desire ${desire.id}`,
      ]);

      await pool.query("UPDATE desires SET status = 'acted' WHERE id = $1", [desire.id]);

      // 清空 curiosity_topics（已派发任务）
      await pool.query(`
        UPDATE working_memory SET value_json = '[]'::jsonb, updated_at = NOW()
        WHERE key = 'curiosity_topics'
      `);

      result.expression.task_created = rows[0]?.id;
      console.log(`[desire] explore → research task created: ${rows[0]?.id}`);
    } catch (err) {
      console.error('[desire] explore task creation error:', err.message);
    }

    return result;
  }

  // Break 3+4 修复：act/follow_up desire → 直接创建任务（桥接到执行管道）
  if (expressionCandidate && (expressionCandidate.desire.type === 'act' || expressionCandidate.desire.type === 'follow_up')) {
    const desire = expressionCandidate.desire;
    result.expression = { triggered: true, acted: true };

    try {
      // act → initiative_plan（交给秋米 /decomp 拆解成可执行 dev 任务）
      // follow_up → review（保持原有行为）
      const taskType = desire.type === 'follow_up' ? 'review' : 'initiative_plan';
      const priority = desire.urgency >= 8 ? 'P0' : desire.urgency >= 5 ? 'P1' : 'P2';

      // ★去重：act 类欲望每次只允许存在 1 个 queued/in_progress 的 desire_system initiative_plan 任务
      // 若已有活跃任务，mark desire as acted 后直接跳过，避免垃圾任务积压
      if (desire.type === 'act') {
        const { rows: existing } = await pool.query(`
          SELECT id FROM tasks
          WHERE trigger_source = 'desire_system'
            AND task_type = 'initiative_plan'
            AND status IN ('queued', 'in_progress')
          LIMIT 1
        `);
        if (existing.length > 0) {
          await pool.query("UPDATE desires SET status = 'acted' WHERE id = $1", [desire.id]);
          console.log(`[desire] act desire skipped (dedup): active initiative_plan task ${existing[0].id} already exists`);
          result.expression = { triggered: false, skipped: 'dedup', existing_task: existing[0].id };
          return result;
        }
      }

      // act 类任务：给秋米足够的上下文来拆解
      const description = desire.type === 'act'
        ? `## 欲望驱动任务（来源：desire_system）\n\n**欲望内容**：${desire.content}\n\n**提议行动**：${desire.proposed_action}\n\n**目标仓库**：cecelia\n\n**洞察**：${desire.insight || '无'}\n\n**来源 desire ID**：${desire.id}`
        : `${desire.proposed_action}\n\n来源：desire ${desire.id}\n洞察：${desire.insight || '无'}`;

      // ★标题规范化：act 类欲望任务加 [欲望建议] 前缀，与正经 PRD 任务区分
      const title = desire.type === 'act'
        ? `[欲望建议] ${desire.content.slice(0, 120)}`
        : desire.content.slice(0, 200);

      const { rows } = await pool.query(`
        INSERT INTO tasks (title, description, priority, task_type, status, trigger_source)
        VALUES ($1, $2, $3, $4, 'queued', 'desire_system')
        RETURNING id
      `, [
        title,
        description,
        priority,
        taskType,
      ]);

      // 更新 desire 状态为 acted
      await pool.query(
        "UPDATE desires SET status = 'acted' WHERE id = $1",
        [desire.id]
      );

      // 广播事件
      try {
        const { publishDesireExpressed } = await import('../events/taskEvents.js');
        publishDesireExpressed({
          id: desire.id,
          type: desire.type,
          urgency: desire.urgency,
          content: desire.content,
          message: `[自主行动] ${desire.content} → 已创建任务 ${rows[0]?.id}`,
        });
      } catch (_) { /* ignore ws errors */ }

      result.expression.task_created = rows[0]?.id;

      // ★NEW: act desire → 额外创建 suggestion（fire-and-forget，不阻塞）
      if (desire.type === 'act') {
        Promise.resolve().then(() => createSuggestion({
          content: `${desire.content.slice(0, 300)}\n\n提议行动：${desire.proposed_action}`,
          source: 'desire_system',
          suggestion_type: 'desire_action',
        })).catch((sugErr) => {
          console.error('[desire] createSuggestion for act failed:', sugErr.message);
        });
      }
    } catch (err) {
      console.error('[desire] act/follow_up task creation error:', err.message);
      result.expression.sent = false;
    }

    return result;
  }

  // Layer 6: 表达（inform/warn/propose 等通知类型）
  if (expressionCandidate) {
    result.expression = { triggered: true };
    try {
      const expressionResult = await runExpression(pool, expressionCandidate.desire);
      result.expression.sent = expressionResult.sent;
    } catch (err) {
      console.error('[desire] expression error:', err.message);
      result.expression.sent = false;
    }

    // ★NEW: warn/propose desire → 额外创建 suggestion（fire-and-forget，不阻塞）
    const desireType = expressionCandidate.desire.type;
    if (desireType === 'warn' || desireType === 'propose') {
      Promise.resolve().then(() => createSuggestion({
        content: `${expressionCandidate.desire.content.slice(0, 300)}\n\n提议行动：${expressionCandidate.desire.proposed_action}`,
        source: 'desire_system',
        suggestion_type: 'desire_action',
      })).catch((sugErr) => {
        console.error('[desire] createSuggestion for warn/propose failed:', sugErr.message);
      });
    }
  }

  return result;
}
