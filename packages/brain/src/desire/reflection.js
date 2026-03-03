/**
 * Layer 3: 反思层（Reflection）
 *
 * 触发条件：desire_importance_accumulator >= 30
 * 取最近 50 条 memory_stream，用 LLM 生成深度洞察。
 * 问：「这些观察意味着什么？有什么模式？有什么风险？」
 * 洞察写入 memory_stream（long 类型，重要性 8），重置 accumulator。
 */

import { callLLM } from '../llm-caller.js';
import { generateL0Summary, generateMemoryStreamL1Async } from '../memory-utils.js';
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
    const result = await callLLM('reflection', prompt, { timeout: 150000 });
    insight = result.text;
  } catch (err) {
    console.error('[reflection] Opus call error:', err.message);
    return { triggered: false };
  }

  if (!insight) {
    return { triggered: false };
  }

  // 去重检查：防止重复洞察占用系统资源
  try {
    // 1. 查询最近 7 天的反思洞察
    const { rows: recentInsights } = await pool.query(`
      SELECT content FROM memory_stream
      WHERE content LIKE '[反思洞察]%'
        AND created_at > NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC
      LIMIT 20
    `);

    // 2. 计算 Jaccard 相似度（字符级分词，支持中文）
    const tokenize = (text) => text.match(/[\u4e00-\u9fa5\u3400-\u4dbf]|[a-zA-Z]{2,}/g) || [];
    const newTokens = new Set(tokenize(insight));
    let maxSimilarity = 0;

    for (const old of recentInsights) {
      const oldContent = old.content.replace('[反思洞察] ', '');
      const oldTokens = new Set(tokenize(oldContent));

      let intersection = 0;
      for (const t of newTokens) { if (oldTokens.has(t)) intersection++; }
      const union = new Set([...newTokens, ...oldTokens]).size;
      const similarity = union > 0 ? intersection / union : 0;

      if (similarity > maxSimilarity) maxSimilarity = similarity;
    }

    // 3. 去重决策
    if (maxSimilarity > 0.75) {
      console.log(`[reflection] Insight skipped (duplicate, similarity=${maxSimilarity.toFixed(2)})`);

      // 重置 accumulator（与正常流程一致）
      await pool.query(`
        INSERT INTO working_memory (key, value_json, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
      `, ['desire_importance_accumulator', 0]);
      console.log(`[reflection] Accumulator reset to 0 (was ${accumulator}) after dedup`);

      return { triggered: true, insight: null, skipped: 'duplicate', similarity: maxSimilarity, accumulator_before: accumulator };
    }

    console.log(`[reflection] Insight unique (max similarity=${maxSimilarity.toFixed(2)}), proceeding to write`);
  } catch (err) {
    // 去重检查失败不影响主流程，继续写入
    console.error('[reflection] dedup check error (non-critical):', err.message);
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
    // Fire-and-forget：异步生成 embedding + L1 摘要，不阻塞反思流程
    const newId = insertResult.rows[0]?.id;
    if (newId) {
      generateMemoryStreamEmbeddingAsync(newId, insightContent, pool);
      generateMemoryStreamL1Async(newId, insightContent, pool);
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
