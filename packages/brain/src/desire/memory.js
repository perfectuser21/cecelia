/**
 * Layer 2: 记忆层（Memory）
 *
 * 所有观察批量打重要性分 1-10（一次 LLM 调用）。
 * 写入 memory_stream 表，并将分数累积到 working_memory desire_importance_accumulator。
 */

import { callLLM } from '../llm-caller.js';

/**
 * 批量为所有观察打重要性分（一次 LLM 调用）
 * @param {Array<{context: string}>} observations
 * @returns {Promise<number[]>} 每个观察的分数数组
 */
async function batchScoreImportance(observations) {
  if (!observations || observations.length === 0) return [];

  const obsLines = observations.map((obs, i) => `${i + 1}. ${obs.context}`).join('\n');

  const prompt = `你是 Cecelia，Alex 的 AI 管家。请评估以下每个观察的重要性，给出 1-10 的整数分数。

观察列表：
${obsLines}

评分标准：
- 1-3: 日常信息，不需要特别关注
- 4-6: 值得记录，但不紧急
- 7-8: 重要，可能需要向 Alex 汇报
- 9-10: 紧急，必须立即关注

请严格按以下格式输出（每行一个分数，对应上面的编号，只输出数字）：
1: 分数
2: 分数
...`;

  try {
    const { text } = await callLLM('memory', prompt, { timeout: 30000 });

    // 解析分数：每行 "N: X" 或纯数字
    const scores = [];
    const lines = text.split('\n').filter(l => l.trim());
    for (let i = 0; i < observations.length; i++) {
      const line = lines[i] || '';
      const numMatch = line.match(/\b([1-9]|10)\b/);
      const score = numMatch ? parseInt(numMatch[1]) : 5;
      scores.push(score >= 1 && score <= 10 ? score : 5);
    }

    return scores;
  } catch (err) {
    console.error('[memory] batchScoreImportance error:', err.message);
    return observations.map(() => 5); // 降级：所有观察默认 5 分
  }
}

/**
 * 将观察写入 memory_stream，并累积 importance 到 accumulator
 * @param {import('pg').Pool} pool
 * @param {Array<{signal: string, value: any, context: string}>} observations
 * @returns {Promise<{written: number, total_importance: number}>}
 */
export async function runMemory(pool, observations) {
  if (!observations || observations.length === 0) {
    return { written: 0, total_importance: 0 };
  }

  // 批量打分（一次 LLM 调用）
  const scores = await batchScoreImportance(observations);

  let totalImportance = 0;
  let written = 0;

  for (let i = 0; i < observations.length; i++) {
    const obs = observations[i];
    const importance = scores[i] || 5;
    const memoryType = importance >= 7 ? 'long' : importance >= 4 ? 'mid' : 'short';
    const expiresAt = memoryType === 'long' ? null
      : memoryType === 'mid' ? new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
      : new Date(Date.now() + 24 * 3600 * 1000).toISOString();

    try {
      await pool.query(`
        INSERT INTO memory_stream (content, importance, memory_type, expires_at)
        VALUES ($1, $2, $3, $4)
      `, [obs.context, importance, memoryType, expiresAt]);
      written++;
    } catch (err) {
      console.error('[memory] memory_stream insert error:', err.message);
    }

    totalImportance += importance;
  }

  // 累积到 desire_importance_accumulator
  if (totalImportance > 0) {
    try {
      const { rows } = await pool.query(
        "SELECT value_json FROM working_memory WHERE key = 'desire_importance_accumulator'"
      );
      const current = typeof rows[0]?.value_json === 'number' ? rows[0].value_json : 0;
      const updated = current + totalImportance;

      await pool.query(`
        INSERT INTO working_memory (key, value_json, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
      `, ['desire_importance_accumulator', updated]);
    } catch (err) {
      console.error('[memory] accumulator update error:', err.message);
    }
  }

  return { written, total_importance: totalImportance };
}
