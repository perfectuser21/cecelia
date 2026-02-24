/**
 * Layer 2: 记忆层（Memory）
 *
 * 每个感知观察打重要性分 1-10（MiniMax M2.5-highspeed）。
 * 写入 memory_stream 表，并将分数累积到 working_memory desire_importance_accumulator。
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

let _minimaxKey = null;

function getMinimaxKey() {
  if (_minimaxKey) return _minimaxKey;
  try {
    const credPath = join(homedir(), '.credentials', 'minimax.json');
    const cred = JSON.parse(readFileSync(credPath, 'utf-8'));
    _minimaxKey = cred.api_key;
    return _minimaxKey;
  } catch (err) {
    console.error('[memory] Failed to load MiniMax credentials:', err.message);
    return null;
  }
}

function stripThinking(content) {
  if (!content) return '';
  return content.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
}

/**
 * 调用 MiniMax M2.5-highspeed 为观察打重要性分
 * @param {string} context - 观察内容
 * @returns {Promise<number>} 1-10 整数
 */
async function scoreImportance(context) {
  const apiKey = getMinimaxKey();
  if (!apiKey) {
    console.warn('[memory] No MiniMax key, defaulting importance to 5');
    return 5;
  }

  const prompt = `你是 Cecelia，Alex 的 AI 管家。请评估以下观察的重要性，给出 1-10 的整数分数。

观察：${context}

评分标准：
- 1-3: 日常信息，不需要特别关注
- 4-6: 值得记录，但不紧急
- 7-8: 重要，可能需要向 Alex 汇报
- 9-10: 紧急，必须立即关注

只输出一个整数，不要其他内容。`;

  try {
    const response = await fetch('https://api.minimaxi.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'MiniMax-M2.5-highspeed',
        max_tokens: 16,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`MiniMax API error: ${response.status}`);
    }

    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content || '';
    const text = stripThinking(rawText);
    const score = parseInt(text.trim());
    if (isNaN(score) || score < 1 || score > 10) return 5;
    return score;
  } catch (err) {
    console.error('[memory] scoreImportance error:', err.message);
    return 5;
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

  let totalImportance = 0;
  let written = 0;

  for (const obs of observations) {
    const importance = await scoreImportance(obs.context);
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
