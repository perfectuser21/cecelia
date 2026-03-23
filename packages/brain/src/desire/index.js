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
import { runEmotionLayer } from '../emotion-layer.js';

/** Layer 1 + 1.5: 感知 + 情绪层 */
async function runPerceptionAndEmotion(pool, result) {
  let observations = [];
  try {
    observations = await runPerception(pool);
    result.perception.observations = observations.length;
  } catch (err) {
    console.error('[desire] perception error:', err.message);
  }

  if (observations.length > 0) {
    try {
      await runEmotionLayer(observations, pool);
    } catch (err) {
      console.warn('[desire] emotion layer error (non-critical):', err.message);
    }
  }

  return observations;
}

/** Layer 2: 记忆层 */
async function runMemoryLayer(pool, observations, result) {
  if (observations.length === 0) return;
  try {
    result.memory = await runMemory(pool, observations);
  } catch (err) {
    console.error('[desire] memory error:', err.message);
  }
}

/** Layer 3 + 4: 反思层 + 欲望形成层 */
async function runReflectionAndFormation(pool, result) {
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

  if (insight) {
    try {
      const formationResult = await runDesireFormation(pool, insight);
      result.desire_formed = formationResult.created;
    } catch (err) {
      console.error('[desire] desire formation error:', err.message);
    }
  }
}

/** Layer 5: 获取表达候选（包装错误处理） */
async function getExpressionCandidate(pool) {
  try {
    return await runExpressionDecision(pool);
  } catch (err) {
    console.error('[desire] expression decision error:', err.message);
    return null;
  }
}

/** 处理 explore 类型欲望 → 写入 suggestions 表 */
async function handleExploreDesire(pool, desire, result) {
  result.expression = { triggered: true, acted: true };
  try {
    const { rows: existing_explore } = await pool.query(`
      SELECT id FROM suggestions
      WHERE source = 'desire_explore'
        AND status = 'pending'
      LIMIT 1
    `);
    if (existing_explore.length > 0) {
      await pool.query("UPDATE desires SET status = 'acted' WHERE id = $1", [desire.id]);
      console.log(`[desire] explore desire skipped (explore_dedup): pending suggestion ${existing_explore[0].id} already exists`);
      result.expression = { triggered: false, skipped: 'explore_dedup', existing_suggestion: existing_explore[0].id };
      return;
    }

    const { rows } = await pool.query(`
      INSERT INTO suggestions (content, source, priority_score, status, suggestion_type, metadata)
      VALUES ($1, 'desire_explore', $2, 'pending', 'research', $3)
      RETURNING id
    `, [
      `[自主探索] ${desire.content.slice(0, 80)}`,
      0.5,
      JSON.stringify({
        desire_id: desire.id,
        desire_type: 'explore',
        proposed_action: desire.proposed_action || desire.content,
        trigger_source: 'curiosity'
      })
    ]);

    await pool.query("UPDATE desires SET status = 'acted' WHERE id = $1", [desire.id]);

    await pool.query(`
      UPDATE working_memory SET value_json = '[]'::jsonb, updated_at = NOW()
      WHERE key = 'curiosity_topics'
    `);

    result.expression.suggestion_created = rows[0]?.id;
    console.log(`[desire] explore → suggestion created: ${rows[0]?.id}`);
  } catch (err) {
    console.error('[desire] explore suggestion creation error:', err.message);
  }
}

/** 处理 act/follow_up 类型欲望 → 写入 suggestions 表 */
async function handleActFollowupDesire(pool, desire, result) {
  result.expression = { triggered: true, acted: true };
  try {
    const suggestionType = desire.type === 'follow_up' ? 'review' : 'initiative_plan';
    const priorityScore = desire.urgency >= 8 ? 0.9 : desire.urgency >= 5 ? 0.7 : 0.5;

    if (desire.type === 'act') {
      const { rows: existing } = await pool.query(`
        SELECT id FROM suggestions
        WHERE source = 'desire_act'
          AND status = 'pending'
        LIMIT 1
      `);
      if (existing.length > 0) {
        await pool.query("UPDATE desires SET status = 'acted' WHERE id = $1", [desire.id]);
        console.log(`[desire] act desire skipped (dedup): pending suggestion ${existing[0].id} already exists`);
        result.expression = { triggered: false, skipped: 'dedup', existing_suggestion: existing[0].id };
        return;
      }
    }

    const content = desire.type === 'act'
      ? `## 欲望驱动建议（来源：desire_system）\n\n**欲望内容**：${desire.content}\n\n**提议行动**：${desire.proposed_action}\n\n**目标仓库**：cecelia\n\n**洞察**：${desire.insight || '无'}\n\n**来源 desire ID**：${desire.id}`
      : `${desire.proposed_action}\n\n来源：desire ${desire.id}\n洞察：${desire.insight || '无'}`;

    const title = desire.type === 'act'
      ? `[欲望建议] ${desire.content.slice(0, 120)}`
      : desire.content.slice(0, 200);

    const source = desire.type === 'act' ? 'desire_act' : 'desire_follow_up';

    const { rows } = await pool.query(`
      INSERT INTO suggestions (content, source, priority_score, status, suggestion_type, metadata)
      VALUES ($1, $2, $3, 'pending', $4, $5)
      RETURNING id
    `, [
      `${title}\n\n${content}`,
      source,
      priorityScore,
      suggestionType,
      JSON.stringify({
        desire_id: desire.id,
        desire_type: desire.type,
        urgency: desire.urgency,
        proposed_action: desire.proposed_action,
        insight: desire.insight || null,
        trigger_source: 'desire_system'
      })
    ]);

    await pool.query(
      "UPDATE desires SET status = 'acted' WHERE id = $1",
      [desire.id]
    );

    try {
      const { publishDesireExpressed } = await import('../events/taskEvents.js');
      publishDesireExpressed({
        id: desire.id,
        type: desire.type,
        urgency: desire.urgency,
        content: desire.content,
        message: `[自主行动] ${desire.content} → 已创建建议 ${rows[0]?.id}`,
      });
    } catch (_) { /* ignore ws errors */ }

    result.expression.suggestion_created = rows[0]?.id;

  } catch (err) {
    console.error('[desire] act/follow_up suggestion creation error:', err.message);
    result.expression.sent = false;
  }
}

/** Layer 6: 表达通知类型欲望（inform/warn/propose 等） */
async function handleNotifyDesire(pool, expressionCandidate, result) {
  result.expression = { triggered: true };
  try {
    const expressionResult = await runExpression(pool, expressionCandidate.desire);
    result.expression.sent = expressionResult.sent;
  } catch (err) {
    console.error('[desire] expression error:', err.message);
    result.expression.sent = false;
  }
}

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

  const observations = await runPerceptionAndEmotion(pool, result);
  await runMemoryLayer(pool, observations, result);
  await runReflectionAndFormation(pool, result);

  const expressionCandidate = await getExpressionCandidate(pool);
  if (!expressionCandidate) return result;

  const { desire } = expressionCandidate;

  if (desire.type === 'explore') {
    await handleExploreDesire(pool, desire, result);
    return result;
  }

  if (desire.type === 'act' || desire.type === 'follow_up') {
    await handleActFollowupDesire(pool, desire, result);
    return result;
  }

  await handleNotifyDesire(pool, expressionCandidate, result);
  return result;
}
