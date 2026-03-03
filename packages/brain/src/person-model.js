/**
 * Person Model — 个人认知表核心模块
 *
 * 为每个与 Cecelia 交互的人建立三层认知模型：
 *   Layer 1 (稳定特征): person_models.stable_traits — 永不衰减
 *   Layer 2 (时序信号): person_signals — 三层衰减（permanent/weekly/hourly）
 *   Layer 3 (当前画像): buildPersonContext() — 综合输出给 LLM
 *
 * 衰减设计：
 *   - 衰减公式：effective_confidence = baseline + (confidence - baseline) * decay_factor
 *     （向基准线衰减，而非向零衰减，符合人类情绪回归基准线的规律）
 *   - 衰减基准：last_accessed_at（上次读取时间），而非 created_at
 *     （被频繁参考的信号保持新鲜度，参考 Stanford Generative Agents 设计）
 *   - Half-life: hourly=2h, weekly=72h, permanent=∞
 */

/* global console */

const DECAY_HALF_LIFE_HOURS = {
  hourly: 2,
  weekly: 72,
  permanent: Infinity
};

const EXPIRES_OFFSET = {
  hourly: 4 * 3600 * 1000,          // 4 小时
  weekly: 7 * 24 * 3600 * 1000,     // 7 天
  permanent: null                    // 永不过期
};

const BASELINE_CONFIDENCE = 0.1;    // 衰减的下限基准置信度

/**
 * 计算信号的有效置信度（考虑时间衰减）
 * @param {Object} signal - person_signals 行
 * @returns {number} 0.0~1.0 的有效置信度
 */
export function computeEffectiveConfidence(signal) {
  if (signal.decay_tier === 'permanent') return signal.confidence;

  const now = Date.now();
  const lastAccessed = new Date(signal.last_accessed_at || signal.created_at).getTime();
  const hoursElapsed = (now - lastAccessed) / (1000 * 3600);
  const halfLife = DECAY_HALF_LIFE_HOURS[signal.decay_tier] || 2;
  const decayFactor = Math.pow(0.5, hoursElapsed / halfLife);

  // 向基准线衰减（不向零衰减）
  return BASELINE_CONFIDENCE + (signal.confidence - BASELINE_CONFIDENCE) * decayFactor;
}

/**
 * 读取某人的稳定特征（person_models）
 * @param {Object} pool - pg pool
 * @param {string} personId - feishu open_id 或 'owner'
 * @returns {Promise<Object|null>}
 */
export async function getPersonModel(pool, personId = 'owner') {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM person_models WHERE person_id = $1 LIMIT 1',
      [personId]
    );
    return rows[0] || null;
  } catch (err) {
    console.warn('[person-model] getPersonModel failed:', err.message);
    return null;
  }
}

/**
 * 更新稳定特征（upsert）
 * @param {Object} pool
 * @param {string} personId
 * @param {Object} traits - 要合并的特征（JSONB merge）
 * @param {Object} [meta] - { name, relationship, baseline_mood, notes }
 */
export async function upsertPersonModel(pool, personId, traits = {}, meta = {}) {
  try {
    await pool.query(
      `INSERT INTO person_models (person_id, name, relationship, stable_traits, baseline_mood, notes, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (person_id) DO UPDATE SET
         name           = COALESCE(EXCLUDED.name, person_models.name),
         relationship   = COALESCE(EXCLUDED.relationship, person_models.relationship),
         stable_traits  = person_models.stable_traits || EXCLUDED.stable_traits,
         baseline_mood  = COALESCE(EXCLUDED.baseline_mood, person_models.baseline_mood),
         notes          = COALESCE(EXCLUDED.notes, person_models.notes),
         updated_at     = NOW()`,
      [
        personId,
        meta.name || null,
        meta.relationship || null,
        JSON.stringify(traits),
        meta.baseline_mood || null,
        meta.notes || null
      ]
    );
  } catch (err) {
    console.warn('[person-model] upsertPersonModel failed:', err.message);
  }
}

/**
 * 记录时序信号
 * @param {Object} pool
 * @param {string} personId
 * @param {string} signalType - 'mood' / 'availability' / 'workload' / 'sentiment' / 'location' / 'other'
 * @param {string} signalValue - 具体值，如 'stressed' / 'busy' / 'available'
 * @param {Object} [options]
 * @param {number} [options.confidence=0.7]
 * @param {string} [options.source='inferred'] - 'explicit' | 'inferred'
 * @param {string} [options.decayTier='hourly'] - 'permanent' | 'weekly' | 'hourly'
 * @param {string} [options.rawExcerpt] - 来源文本片段
 */
export async function recordSignal(pool, personId, signalType, signalValue, options = {}) {
  const {
    confidence = 0.7,
    source = 'inferred',
    decayTier = 'hourly',
    rawExcerpt = null
  } = options;

  const offsetMs = EXPIRES_OFFSET[decayTier];
  const expiresAt = offsetMs ? new Date(Date.now() + offsetMs).toISOString() : null;

  try {
    await pool.query(
      `INSERT INTO person_signals
         (person_id, signal_type, signal_value, confidence, source, decay_tier, expires_at, raw_excerpt, last_accessed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [personId, signalType, signalValue, confidence, source, decayTier, expiresAt, rawExcerpt]
    );
  } catch (err) {
    console.warn('[person-model] recordSignal failed:', err.message);
  }
}

/**
 * 读取某人的活跃信号（未过期，按有效置信度排序）
 * 同时更新 last_accessed_at（用于访问时间衰减）
 *
 * @param {Object} pool
 * @param {string} personId
 * @param {string} [signalType] - 可选，过滤特定类型
 * @returns {Promise<Array>} - 带 effective_confidence 字段的信号列表
 */
export async function getActiveSignals(pool, personId, signalType = null) {
  try {
    const params = [personId];
    let typeClause = '';
    if (signalType) {
      params.push(signalType);
      typeClause = `AND signal_type = $${params.length}`;
    }

    const { rows } = await pool.query(
      `SELECT * FROM person_signals
       WHERE person_id = $1
         AND (expires_at IS NULL OR expires_at > NOW())
         ${typeClause}
       ORDER BY created_at DESC`,
      params
    );

    if (rows.length === 0) return [];

    // 计算有效置信度
    const withDecay = rows.map(sig => ({
      ...sig,
      effective_confidence: computeEffectiveConfidence(sig)
    }));

    // 过滤低于阈值的信号（有效置信度 < 0.15）
    const active = withDecay.filter(s => s.effective_confidence >= 0.15);

    // 批量更新 last_accessed_at（fire-and-forget）
    const ids = active.map(s => s.id);
    if (ids.length > 0) {
      pool.query(
        `UPDATE person_signals SET last_accessed_at = NOW()
         WHERE id = ANY($1::uuid[])`,
        [ids]
      ).catch(() => {});
    }

    return active.sort((a, b) => b.effective_confidence - a.effective_confidence);
  } catch (err) {
    console.warn('[person-model] getActiveSignals failed:', err.message);
    return [];
  }
}

/**
 * 构建 LLM 可读的个人上下文摘要
 * @param {Object} pool
 * @param {string} personId
 * @returns {Promise<string>} - 格式化的上下文字符串
 */
export async function buildPersonContext(pool, personId = 'owner') {
  const [model, signals] = await Promise.all([
    getPersonModel(pool, personId),
    getActiveSignals(pool, personId)
  ]);

  const parts = [];

  if (model) {
    const traits = model.stable_traits || {};
    if (Object.keys(traits).length > 0) {
      parts.push(`【稳定特征】${JSON.stringify(traits)}`);
    }
  }

  if (signals.length > 0) {
    // 按类型分组，每类取最高置信度
    const byType = {};
    for (const s of signals) {
      if (!byType[s.signal_type] || s.effective_confidence > byType[s.signal_type].effective_confidence) {
        byType[s.signal_type] = s;
      }
    }
    const signalLines = Object.values(byType).map(s => {
      const confPct = Math.round(s.effective_confidence * 100);
      return `${s.signal_type}=${s.signal_value}(置信度${confPct}%,来源:${s.source})`;
    });
    parts.push(`【当前状态】${signalLines.join(', ')}`);
  }

  return parts.length > 0 ? parts.join('\n') : '（暂无记录）';
}

/**
 * 从对话中异步提取人物信号（fire-and-forget 调用入口）
 *
 * 设计：使用轻量 LLM（Haiku）从单条对话中推断信号，写入 person_signals
 *
 * @param {Object} pool
 * @param {string} personId
 * @param {string} userMessage - 用户消息
 * @param {string} ceceliaReply - Cecelia 回复（提供对话上下文）
 * @param {Function} callLLM - LLM 调用函数（注入依赖）
 */
export async function extractPersonSignals(pool, personId, userMessage, ceceliaReply, callLLM) {
  if (!userMessage || userMessage.trim().length < 5) return;

  const prompt = `你是一个对话分析助手。分析以下对话，提取关于用户的状态信号。

用户消息：${userMessage}
Cecelia回复：${ceceliaReply}

请识别并返回 JSON 数组，每个元素包含：
{
  "signal_type": "mood|availability|workload|sentiment|other",
  "signal_value": "具体值（如: stressed/calm/busy/available/positive/negative）",
  "confidence": 0.1~1.0,
  "source": "explicit（用户明说）|inferred（从语气推断）",
  "decay_tier": "hourly（几小时内有效）|weekly（一周内有效）|permanent（长期特征）",
  "raw_excerpt": "支持该判断的原文片段"
}

规则：
- 只提取有把握的信号（confidence < 0.4 的不要）
- 临时状态用 hourly，这周的状态用 weekly，性格特征用 permanent
- 如果没有可提取的信号，返回空数组 []
- 只返回 JSON，不要解释

示例输出：
[{"signal_type":"availability","signal_value":"busy","confidence":0.8,"source":"explicit","decay_tier":"hourly","raw_excerpt":"我在忙"}]`;

  try {
    const { text } = await callLLM('thalamus', prompt, { maxTokens: 512, timeout: 15000 });
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;

    const signals = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(signals) || signals.length === 0) return;

    for (const sig of signals) {
      if (!sig.signal_type || !sig.signal_value) continue;
      await recordSignal(pool, personId, sig.signal_type, sig.signal_value, {
        confidence: sig.confidence || 0.5,
        source: sig.source || 'inferred',
        decayTier: sig.decay_tier || 'hourly',
        rawExcerpt: sig.raw_excerpt || null
      });
    }

    console.log(`[person-model] 从对话提取 ${signals.length} 个信号 (person: ${personId})`);
  } catch (err) {
    // fire-and-forget，静默失败
    console.warn('[person-model] extractPersonSignals failed:', err.message);
  }
}
