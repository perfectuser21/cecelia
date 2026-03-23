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

// 静默期机制：连续N轮跳过后进入静默期，避免无限循环
const SILENCE_SKIP_THRESHOLD = 3; // 连续3轮跳过（重复或相似度>0.6）→ 进入静默期
const SILENCE_DURATION_HOURS = 24; // 静默期时长（小时）

// Jaccard 相似度阈值（降低以捕获更多语义重复）
const SIMILARITY_THRESHOLD = 0.6;

// 内存缓存（启动时从 DB 加载，运行时同步写入 DB）
let _consecutiveDuplicates = 0;
let _lastInsightHash = null;
let _consecutiveSkips = 0;
let _breakerStateLoaded = false;

/**
 * 从 DB 加载熔断器状态（启动后首次调用时执行）
 */
async function _loadBreakerState(pool) {
  if (_breakerStateLoaded) return;
  try {
    const { rows } = await pool.query(
      "SELECT value_json FROM working_memory WHERE key = 'reflection_breaker_state'"
    );
    if (rows[0]?.value_json) {
      const state = typeof rows[0].value_json === 'string'
        ? JSON.parse(rows[0].value_json)
        : rows[0].value_json;
      _consecutiveDuplicates = state.consecutiveDuplicates ?? 0;
      _lastInsightHash = state.lastInsightHash ?? null;
      _consecutiveSkips = state.consecutiveSkips ?? 0;
      console.log(`[reflection] Breaker state loaded from DB: dups=${_consecutiveDuplicates}, skips=${_consecutiveSkips}, hash=${_lastInsightHash?.slice(0, 8) ?? 'null'}`);
    }
  } catch (err) {
    console.error('[reflection] Failed to load breaker state from DB (using defaults):', err.message);
  }
  _breakerStateLoaded = true;
}

/**
 * 将熔断器状态持久化到 DB
 */
async function _saveBreakerState(pool) {
  try {
    const state = {
      consecutiveDuplicates: _consecutiveDuplicates,
      lastInsightHash: _lastInsightHash,
      consecutiveSkips: _consecutiveSkips,
      updatedAt: new Date().toISOString(),
    };
    await pool.query(`
      INSERT INTO working_memory (key, value_json, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
    `, ['reflection_breaker_state', JSON.stringify(state)]);
  } catch (err) {
    console.error('[reflection] Failed to save breaker state to DB:', err.message);
  }
}

// 导出内部函数供测试使用
export { _loadBreakerState, _saveBreakerState };

// 导出重置函数供测试使用
export function _resetBreakerStateForTest() {
  _consecutiveDuplicates = 0;
  _lastInsightHash = null;
  _consecutiveSkips = 0;
  _breakerStateLoaded = false;
}

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

// ── 提取的子函数 ────────────────────────────────────────────

/**
 * 检查静默期，已过期则自动清除
 * @returns {{inSilence: boolean, silenceUntil?: string}}
 */
async function _checkAndClearSilencePeriod(pool) {
  try {
    const { rows } = await pool.query(
      "SELECT value_json FROM working_memory WHERE key = 'reflection_silence_until'"
    );
    const silenceUntil = rows[0]?.value_json;
    if (!silenceUntil) return { inSilence: false };

    const silenceEnd = new Date(silenceUntil);
    if (Date.now() < silenceEnd.getTime()) {
      const remainingHours = Math.round((silenceEnd.getTime() - Date.now()) / (1000 * 60 * 60));
      console.log(`[reflection] 静默期中，剩余 ${remainingHours} 小时（至 ${silenceEnd.toISOString()}）`);
      return { inSilence: true, silenceUntil };
    }

    // 静默期已结束，清除记录
    await pool.query("DELETE FROM working_memory WHERE key = 'reflection_silence_until'");
    _consecutiveSkips = 0;
    await _saveBreakerState(pool);
    console.log('[reflection] 静默期已结束，恢复正常反思');
    return { inSilence: false };
  } catch (err) {
    // DB 错误降级：跳过静默检查，继续反思（避免因 DB 故障导致反思永久失效）
    console.error('[reflection] 静默期检查失败（降级继续）:', err.message);
    return { inSilence: false };
  }
}

/**
 * 对记忆列表做 Jaccard 去重（简单词袋模型）
 */
function _deduplicateMemories(memories) {
  const deduped = [];
  for (const m of memories) {
    const tokensM = new Set(m.content.toLowerCase().split(/\s+/).filter(t => t.length > 1));
    const isDuplicate = deduped.some(existing => {
      const tokensE = new Set(existing.content.toLowerCase().split(/\s+/).filter(t => t.length > 1));
      if (tokensM.size === 0 && tokensE.size === 0) return false;
      let intersection = 0;
      for (const t of tokensM) { if (tokensE.has(t)) intersection++; }
      const union = new Set([...tokensM, ...tokensE]).size;
      return union > 0 && (intersection / union) > 0.7;
    });
    if (!isDuplicate) deduped.push(m);
  }
  return deduped;
}

/**
 * 取最近 50 条 memory_stream 并去重
 */
async function _fetchAndDeduplicateMemories(pool) {
  const { rows } = await pool.query(`
    SELECT content, importance, memory_type, created_at
    FROM memory_stream
    WHERE content NOT LIKE '[反思洞察]%'
      AND content NOT LIKE '[反思折叠]%'
      AND content NOT LIKE '[反思静默]%'
    ORDER BY created_at DESC
    LIMIT 50
  `);
  return _deduplicateMemories(rows);
}

/**
 * 中文+英文分词（bigram + word）
 */
function _tokenize(text) {
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
}

/**
 * 计算新洞察与近期洞察的最大 Jaccard 相似度
 */
function _computeMaxSimilarity(insight, recentInsights) {
  const newTokens = new Set(_tokenize(insight));
  let maxSimilarity = 0;
  for (const old of recentInsights) {
    const oldContent = old.content.replace('[反思洞察] ', '');
    const oldTokens = new Set(_tokenize(oldContent));
    let intersection = 0;
    for (const t of newTokens) { if (oldTokens.has(t)) intersection++; }
    const union = new Set([...newTokens, ...oldTokens]).size;
    const similarity = union > 0 ? intersection / union : 0;
    if (similarity > maxSimilarity) maxSimilarity = similarity;
  }
  return maxSimilarity;
}

/**
 * 若连续跳过次数达阈值则进入静默期
 */
async function _enterSilencePeriodIfNeeded(pool) {
  if (_consecutiveSkips < SILENCE_SKIP_THRESHOLD) return;

  const silenceUntil = new Date(Date.now() + SILENCE_DURATION_HOURS * 60 * 60 * 1000).toISOString();
  await pool.query(`
    INSERT INTO working_memory (key, value_json, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
  `, ['reflection_silence_until', silenceUntil]);
  console.warn(`[reflection] 进入静默期 ${SILENCE_DURATION_HOURS} 小时（至 ${silenceUntil}），连续 ${_consecutiveSkips} 轮跳过`);

  await pool.query(`
    INSERT INTO memory_stream (content, importance, memory_type, expires_at)
    VALUES ($1, 7, 'long', NOW() + INTERVAL '7 days')
  `, [`[反思静默] 连续${_consecutiveSkips}轮反思被跳过（重复/相似度过高），已进入${SILENCE_DURATION_HOURS}小时静默期。静默期至 ${silenceUntil}。`]);

  _consecutiveSkips = 0; // 重置计数器（已进入静默期）
}

/**
 * 重置 accumulator 到 0
 */
async function _resetAccumulator(pool, accumulator) {
  await pool.query(`
    INSERT INTO working_memory (key, value_json, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
  `, ['desire_importance_accumulator', 0]);
  console.log(`[reflection] Accumulator reset to 0 (was ${accumulator})`);
}

/**
 * 处理熔断器触发（连续重复超过阈值）
 * @returns {{skipped: true, result: object}}
 */
async function _handleCircuitBreaker(pool, currentHash, accumulator) {
  console.error(`[reflection] Circuit breaker triggered: ${_consecutiveDuplicates} consecutive duplicates, skipping insight`);

  _consecutiveSkips++;
  console.log(`[reflection] 连续跳过次数: ${_consecutiveSkips}/${SILENCE_SKIP_THRESHOLD}`);

  // 写入折叠记录（可追溯，而非完全丢弃）
  await pool.query(`
    INSERT INTO memory_stream (content, importance, memory_type, expires_at)
    VALUES ($1, 4, 'short', NOW() + INTERVAL '3 days')
  `, [`[反思折叠] 第${_consecutiveDuplicates}次完全相同的洞察，已自动折叠。hash=${currentHash.slice(0, 8)}`]);

  // 重置熔断计数器和哈希（防止永久锁死）
  _consecutiveDuplicates = 0;
  _lastInsightHash = null;

  await _resetAccumulator(pool, accumulator);
  await _enterSilencePeriodIfNeeded(pool);
  await _saveBreakerState(pool);

  return {
    skipped: true,
    result: { triggered: true, insight: null, skipped: 'circuit_breaker', consecutive_duplicates: _consecutiveDuplicates, accumulator_before: accumulator },
  };
}

/**
 * 处理 Jaccard 相似度去重跳过
 * @returns {{skipped: true, result: object}}
 */
async function _handleJaccardDedup(pool, maxSimilarity, accumulator) {
  console.log(`[reflection] Insight skipped (duplicate, similarity=${maxSimilarity.toFixed(2)}, threshold=${SIMILARITY_THRESHOLD})`);

  _consecutiveSkips++;
  console.log(`[reflection] 连续跳过次数: ${_consecutiveSkips}/${SILENCE_SKIP_THRESHOLD}`);

  // 写入折叠记录（可追溯）
  await pool.query(`
    INSERT INTO memory_stream (content, importance, memory_type, expires_at)
    VALUES ($1, 4, 'short', NOW() + INTERVAL '3 days')
  `, [`[反思折叠] 与近7天洞察相似度${maxSimilarity.toFixed(2)}，已自动折叠。连续跳过: ${_consecutiveSkips}/${SILENCE_SKIP_THRESHOLD}`]);

  // 重置 accumulator（与正常流程一致）
  await _resetAccumulator(pool, accumulator);
  await _enterSilencePeriodIfNeeded(pool);
  await _saveBreakerState(pool);

  return {
    skipped: true,
    result: { triggered: true, insight: null, skipped: 'duplicate', similarity: maxSimilarity, accumulator_before: accumulator },
  };
}

/**
 * 去重检查：哈希熔断 + Jaccard 相似度
 * @returns {{skipped: boolean, result?: object}}
 */
async function _checkInsightDedup(pool, insight, accumulator) {
  const crypto = await import('crypto');
  const currentHash = crypto.createHash('sha256').update(insight).digest('hex').slice(0, 16);

  // 1. 连续重复检测（熔断机制）
  if (_lastInsightHash === currentHash) {
    _consecutiveDuplicates++;
    console.warn(`[reflection] Consecutive duplicate detected (count=${_consecutiveDuplicates}, hash=${currentHash.slice(0, 8)}...)`);
    if (_consecutiveDuplicates >= CIRCUIT_BREAKER_THRESHOLD) {
      return _handleCircuitBreaker(pool, currentHash, accumulator);
    }
  } else {
    // 内容不同，重置连续重复计数器
    _consecutiveDuplicates = 0;
    _lastInsightHash = currentHash;
  }

  // 2. 查询最近 7 天的反思洞察并计算相似度
  const { rows: recentInsights } = await pool.query(`
    SELECT content FROM memory_stream
    WHERE content LIKE '[反思洞察]%'
      AND created_at > NOW() - INTERVAL '7 days'
    ORDER BY created_at DESC
    LIMIT 20
  `);

  const maxSimilarity = _computeMaxSimilarity(insight, recentInsights);

  if (maxSimilarity > SIMILARITY_THRESHOLD) {
    return _handleJaccardDedup(pool, maxSimilarity, accumulator);
  }

  console.log(`[reflection] Insight unique (max similarity=${maxSimilarity.toFixed(2)}, threshold=${SIMILARITY_THRESHOLD}), proceeding to write`);
  await _saveBreakerState(pool);
  return { skipped: false };
}

/**
 * 写入洞察到 memory_stream，重置跳过计数器
 */
async function _writeInsight(pool, insight) {
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
  await _saveBreakerState(pool);
  console.log('[reflection] 洞察已成功写入，跳过计数器已重置');
}

// ── 主函数辅助 ──────────────────────────────────────────────

/**
 * 构造 prompt 并调用 LLM，失败返回 null
 */
async function _callLLMForReflection(memories, accumulator) {
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

  try {
    const result = await callLLM('reflection', prompt, { timeout: 150000 });
    return result.text || null;
  } catch (err) {
    console.error('[reflection] Opus call error:', err.message);
    return null;
  }
}

/**
 * 写入洞察并重置 accumulator（各自独立 try/catch，互不影响）
 */
async function _persistInsightAndReset(pool, insight, accumulator) {
  try {
    await _writeInsight(pool, insight);
  } catch (err) {
    console.error('[reflection] insight insert error:', err.message);
  }
  try {
    await _resetAccumulator(pool, accumulator);
  } catch (err) {
    console.error('[reflection] reset accumulator error:', err.message);
  }
}

// ── 主函数 ───────────────────────────────────────────────────

/**
 * 运行反思层
 * @param {import('pg').Pool} pool
 * @returns {Promise<{triggered: boolean, insight?: string, accumulator_before?: number}>}
 */
export async function runReflection(pool) {
  // 0. 从 DB 加载熔断器状态（首次调用时）
  await _loadBreakerState(pool);

  // 1. 检查静默期
  const silenceCheck = await _checkAndClearSilencePeriod(pool);
  if (silenceCheck.inSilence) {
    return { triggered: false, reason: 'in_silence_period', silence_until: silenceCheck.silenceUntil };
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

  // 3. 取最近 50 条记忆并去重
  let memories = [];
  try {
    memories = await _fetchAndDeduplicateMemories(pool);
  } catch (err) {
    console.error('[reflection] fetch memories error:', err.message);
    return { triggered: false };
  }
  if (memories.length === 0) {
    return { triggered: false };
  }

  // 4. 构造 prompt 并调用 LLM（错误由子函数处理，失败返回 null）
  const insight = await _callLLMForReflection(memories, accumulator);
  if (!insight) {
    return { triggered: false };
  }

  // 5. 去重检查（哈希熔断 + Jaccard 相似度）
  try {
    const dedupResult = await _checkInsightDedup(pool, insight, accumulator);
    if (dedupResult.skipped) {
      return dedupResult.result;
    }
  } catch (err) {
    // 去重检查失败不影响主流程，继续写入
    console.error('[reflection] dedup check error (non-critical):', err.message);
  }

  // 6. 写入 memory_stream + 重置 accumulator
  await _persistInsightAndReset(pool, insight, accumulator);

  return { triggered: true, insight, accumulator_before: accumulator };
}
