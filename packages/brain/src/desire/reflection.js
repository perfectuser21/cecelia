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

// 熔断机制：检测连续重复内容
const CIRCUIT_BREAKER_THRESHOLD = 3; // 连续3轮相同内容 → 触发熔断
let _consecutiveDuplicates = 0;
let _lastInsightHash = null;

// 静默期机制：连续N轮跳过后进入静默期，避免无限循环
const SILENCE_SKIP_THRESHOLD = 3; // 连续3轮跳过（重复或相似度>0.75）→ 进入静默期
const SILENCE_DURATION_HOURS = 24; // 静默期时长（小时）
let _consecutiveSkips = 0; // 跟踪连续跳过次数（包括熔断和相似度去重）

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
  // 1. 检查静默期（连续跳过导致的熔断静默）
  try {
    const { rows } = await pool.query(
      "SELECT value_json FROM working_memory WHERE key = 'reflection_silence_until'"
    );
    const silenceUntil = rows[0]?.value_json;
    if (silenceUntil) {
      const silenceEnd = new Date(silenceUntil);
      if (Date.now() < silenceEnd.getTime()) {
        const remainingHours = Math.round((silenceEnd.getTime() - Date.now()) / (1000 * 60 * 60));
        console.log(`[reflection] 静默期中，剩余 ${remainingHours} 小时（至 ${silenceEnd.toISOString()}）`);
        return { triggered: false, reason: 'in_silence_period', silence_until: silenceUntil };
      } else {
        // 静默期已结束，清除记录
        await pool.query("DELETE FROM working_memory WHERE key = 'reflection_silence_until'");
        _consecutiveSkips = 0; // 重置跳过计数器
        console.log('[reflection] 静默期已结束，恢复正常反思');
      }
    }
  } catch (err) {
    // DB 错误降级：跳过静默检查，继续反思（避免因 DB 故障导致反思永久失效）
    console.error('[reflection] 静默期检查失败（降级继续）:', err.message);
  }

  // 2. 检查 accumulator 阈值
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
    // 1. 计算当前洞察的哈希值（简单哈希，用于连续重复检测）
    const crypto = await import('crypto');
    const currentHash = crypto.createHash('sha256').update(insight).digest('hex').slice(0, 16);

    // 2. 连续重复检测（熔断机制）
    if (_lastInsightHash === currentHash) {
      _consecutiveDuplicates++;
      console.warn(`[reflection] Consecutive duplicate detected (count=${_consecutiveDuplicates}, hash=${currentHash.slice(0, 8)}...)`);

      if (_consecutiveDuplicates >= CIRCUIT_BREAKER_THRESHOLD) {
        console.error(`[reflection] ⚠️  Circuit breaker triggered: ${_consecutiveDuplicates} consecutive duplicates, skipping insight`);

        // 增加连续跳过计数
        _consecutiveSkips++;
        console.log(`[reflection] 连续跳过次数: ${_consecutiveSkips}/${SILENCE_SKIP_THRESHOLD}`);

        // 重置熔断计数器和哈希（防止永久锁死）
        _consecutiveDuplicates = 0;
        _lastInsightHash = null;

        // 重置 accumulator
        await pool.query(`
          INSERT INTO working_memory (key, value_json, updated_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
        `, ['desire_importance_accumulator', 0]);
        console.log(`[reflection] Accumulator reset to 0 (was ${accumulator}) after circuit breaker`);

        // 检查是否需要进入静默期
        if (_consecutiveSkips >= SILENCE_SKIP_THRESHOLD) {
          const silenceUntil = new Date(Date.now() + SILENCE_DURATION_HOURS * 60 * 60 * 1000).toISOString();
          await pool.query(`
            INSERT INTO working_memory (key, value_json, updated_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
          `, ['reflection_silence_until', silenceUntil]);
          console.warn(`[reflection] ⚠️  进入静默期 ${SILENCE_DURATION_HOURS} 小时（至 ${silenceUntil}），连续 ${_consecutiveSkips} 轮跳过`);

          // 写入静默期事件到 memory_stream
          await pool.query(`
            INSERT INTO memory_stream (content, importance, memory_type, expires_at)
            VALUES ($1, 7, 'long', NOW() + INTERVAL '7 days')
          `, [`[反思静默] 连续${_consecutiveSkips}轮反思被跳过（重复/相似度过高），已进入${SILENCE_DURATION_HOURS}小时静默期。静默期至 ${silenceUntil}。`]);

          _consecutiveSkips = 0; // 重置计数器（已进入静默期）
        } else {
          // 未达到静默阈值，写入普通熔断事件
          await pool.query(`
            INSERT INTO memory_stream (content, importance, memory_type, expires_at)
            VALUES ($1, 6, 'long', NOW() + INTERVAL '7 days')
          `, [`[反思熔断] 检测到连续${_consecutiveDuplicates}轮重复内容，已触发熔断机制跳过本次反思。连续跳过次数: ${_consecutiveSkips}/${SILENCE_SKIP_THRESHOLD}。`]);
        }

        return { triggered: true, insight: null, skipped: 'circuit_breaker', consecutive_duplicates: _consecutiveDuplicates, accumulator_before: accumulator };
      }
    } else {
      // 内容不同，重置连续重复计数器
      _consecutiveDuplicates = 0;
      _lastInsightHash = currentHash;
    }

    // 3. 查询最近 7 天的反思洞察（原有的相似度检查）
    const { rows: recentInsights } = await pool.query(`
      SELECT content FROM memory_stream
      WHERE content LIKE '[反思洞察]%'
        AND created_at > NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC
      LIMIT 20
    `);

    // 4. 计算 Jaccard 相似度（字符级分词，支持中文）
    const tokenize = (text) => {
      const tokens = [];
      const segs = text.match(/[\u4e00-\u9fa5\u3400-\u4dbf]+|[a-zA-Z]{2,}/g) || [];
      for (const s of segs) {
        if (/[\u4e00-\u9fa5]/.test(s)) {
          for (let i = 0; i < s.length - 1; i++) tokens.push(s.slice(i, i + 2));
          if (s.length === 1) tokens.push(s); // 单字 fallback
        } else {
          tokens.push(s.toLowerCase());
        }
      }
      return tokens;
    };
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

    // 5. 去重决策（原有逻辑）
    if (maxSimilarity > 0.75) {
      console.log(`[reflection] Insight skipped (duplicate, similarity=${maxSimilarity.toFixed(2)})`);

      // 增加连续跳过计数
      _consecutiveSkips++;
      console.log(`[reflection] 连续跳过次数: ${_consecutiveSkips}/${SILENCE_SKIP_THRESHOLD}`);

      // 重置 accumulator（与正常流程一致）
      await pool.query(`
        INSERT INTO working_memory (key, value_json, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
      `, ['desire_importance_accumulator', 0]);
      console.log(`[reflection] Accumulator reset to 0 (was ${accumulator}) after dedup`);

      // 检查是否需要进入静默期
      if (_consecutiveSkips >= SILENCE_SKIP_THRESHOLD) {
        const silenceUntil = new Date(Date.now() + SILENCE_DURATION_HOURS * 60 * 60 * 1000).toISOString();
        await pool.query(`
          INSERT INTO working_memory (key, value_json, updated_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
        `, ['reflection_silence_until', silenceUntil]);
        console.warn(`[reflection] ⚠️  进入静默期 ${SILENCE_DURATION_HOURS} 小时（至 ${silenceUntil}），连续 ${_consecutiveSkips} 轮跳过`);

        // 写入静默期事件到 memory_stream
        await pool.query(`
          INSERT INTO memory_stream (content, importance, memory_type, expires_at)
          VALUES ($1, 7, 'long', NOW() + INTERVAL '7 days')
        `, [`[反思静默] 连续${_consecutiveSkips}轮反思被跳过（重复/相似度过高），已进入${SILENCE_DURATION_HOURS}小时静默期。静默期至 ${silenceUntil}。`]);

        _consecutiveSkips = 0; // 重置计数器（已进入静默期）
      }

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

    // 成功写入洞察，重置跳过计数器
    _consecutiveSkips = 0;
    console.log('[reflection] 洞察已成功写入，跳过计数器已重置');
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
