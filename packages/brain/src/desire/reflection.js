/**
 * Layer 3: 反思层（Reflection）
 *
 * 触发条件：desire_importance_accumulator >= 30
 * 取最近 50 条 memory_stream，用 LLM 生成深度洞察。
 * 问：「这些观察意味着什么？有什么模式？有什么风险？」
 * 洞察写入 memory_stream（long 类型，重要性 8），重置 accumulator。
 */

import { callLLM } from '../llm-caller.js';
import { generateL0Summary } from '../memory-utils.js';
import { generateMemoryStreamEmbeddingAsync } from '../embedding-service.js';

const REFLECTION_THRESHOLD = 12;

/**
 * 读取当前 accumulator 值
 */
async function getAccumulator(pool) {
  const { rows } = await pool.query(
    "SELECT value_json FROM working_memory WHERE key = 'desire_importance_accumulator'"
  );
  const val = rows[0]?.value_json;
  return typeof val === 'number' ? val : 0;
}

/**
 * 运行反思层
 * @param {import('pg').Pool} pool
 * @returns {Promise<{triggered: boolean, insight?: string, accumulator_before?: number}>}
 */
export async function runReflection(pool) {
  let accumulator = 0;
  try {
    accumulator = await getAccumulator(pool);
  } catch (err) {
    console.error('[reflection] get accumulator error:', err.message);
    return { triggered: false };
  }

  if (accumulator < REFLECTION_THRESHOLD) {
    return { triggered: false, accumulator };
  }

  // 取最近 50 条记忆
  let memories = [];
  try {
    const { rows } = await pool.query(`
      SELECT content, importance, memory_type, created_at
      FROM memory_stream
      ORDER BY created_at DESC
      LIMIT 50
    `);
    memories = rows;
  } catch (err) {
    console.error('[reflection] fetch memories error:', err.message);
    return { triggered: false };
  }

  if (memories.length === 0) {
    return { triggered: false };
  }

  // 去重：memory_stream 中大量重复感知信号会淹没反思质量
  // 使用简单 Jaccard 去重，保留多样化的记忆
  const dedupedMemories = [];
  for (const m of memories) {
    const isDuplicate = dedupedMemories.some(existing => {
      const tokensA = new Set(m.content.toLowerCase().split(/\s+/).filter(t => t.length > 1));
      const tokensB = new Set(existing.content.toLowerCase().split(/\s+/).filter(t => t.length > 1));
      if (tokensA.size === 0 && tokensB.size === 0) return false;
      let intersection = 0;
      for (const t of tokensA) { if (tokensB.has(t)) intersection++; }
      const union = new Set([...tokensA, ...tokensB]).size;
      return union > 0 && (intersection / union) > 0.7;
    });
    if (!isDuplicate) dedupedMemories.push(m);
  }
  memories = dedupedMemories;

  const memorySummary = memories
    .map((m, i) => `${i + 1}. [重要性${m.importance}] ${m.content}`)
    .join('\n');

  const prompt = `你是 Cecelia，Alex 的 AI 管家，24/7 管理 Perfect21 所有系统。

以下是你最近的系统观察记录：

${memorySummary}

请深入反思这些观察：
1. 这些信号意味着什么？有哪些值得关注的模式？
2. 有哪些潜在风险或机会？
3. 什么是最需要向 Alex 汇报的？

要求：
- 从管家视角，带洞察（不只是总结）
- 简洁有力，不超过 300 字
- 结构：发现的模式 → 风险或机会 → 建议`;

  let insight = '';
  try {
    console.log(`[reflection] Calling LLM for deep reflection (accumulator=${accumulator})...`);
    const result = await callLLM('reflection', prompt, { timeout: 60000 });
    insight = result.text;
  } catch (err) {
    console.error('[reflection] Opus call error:', err.message);
    return { triggered: false };
  }

  if (!insight) {
    return { triggered: false };
  }

  // 写入 memory_stream（long 类型，高重要性，附带 L0 摘要）
  try {
    const insightContent = `[反思洞察] ${insight}`;
    const insightSummary = generateL0Summary(insightContent);
    const insertResult = await pool.query(`
      INSERT INTO memory_stream (content, importance, memory_type, expires_at, summary)
      VALUES ($1, 8, 'long', NULL, $2)
      RETURNING id
    `, [insightContent, insightSummary]);
    // Fire-and-forget：异步生成 embedding，不阻塞反思流程
    const newId = insertResult.rows[0]?.id;
    if (newId) {
      generateMemoryStreamEmbeddingAsync(newId, insightContent, pool);
    }
  } catch (err) {
    console.error('[reflection] insight insert error:', err.message);
  }

  // 重置 accumulator
  try {
    await pool.query(`
      INSERT INTO working_memory (key, value_json, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
    `, ['desire_importance_accumulator', 0]);
    console.log(`[reflection] Accumulator reset to 0 (was ${accumulator})`);
  } catch (err) {
    console.error('[reflection] reset accumulator error:', err.message);
  }

  return { triggered: true, insight, accumulator_before: accumulator };
}
