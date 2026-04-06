/**
 * fact-extractor.js — 混合事实捕获（正则 + Haiku + 反哺进化）
 *
 * 职责：
 *   1. 正则快速提取显式事实（零延迟、零成本）
 *   2. Haiku 补全正则漏掉的内容（fire-and-forget 并行）
 *   3. Haiku 发现的 gap → 写入 learned_keywords 表，下次正则加载后自动命中
 *   4. 用户偏好/习惯 → person_signals (signal_type='preference', decay_tier='permanent')
 *   5. 对 Cecelia 的行为纠正 → learnings (category='behavior_correction')
 *   6. 新事实与已有同类比对，发现矛盾 → pending_conversations 请求澄清
 *
 * 设计原则：
 *   - 正则宁可漏掉，不要误报（conservative 模式）
 *   - Haiku 覆盖正则盲区，gap 反哺词库
 *   - Haiku 失败不影响正则结果（静默降级）
 *   - fire-and-forget 调用，失败静默
 */

// ─────────────────────────────────────────────
// 1. 正则模式定义
// ─────────────────────────────────────────────

/**
 * 用户偏好/习惯模式（针对 Alex 自己的事实）
 * group 1: 极性词（喜欢/不喜欢/...）
 * group 2: 对象（喝茶/蓝色/...）
 */
const PREFERENCE_PATTERNS = [
  // 正向偏好：我喜欢X / 我爱X / 我想要X
  { re: /我(?:很|非常|特别|超级|比较|有点)?(喜欢|爱|享受|偏爱|喜好)\s*(.{2,20}?)(?:[。，,\s]|$)/g, polarity: 'positive' },
  // 负向偏好：我不喜欢X / 我讨厌X / 我不想要X
  { re: /我(?:不喜欢|不爱|讨厌|厌恶|不想|不要|不需要|反感)\s*(.{2,20}?)(?:[。，,\s]|$)/g, polarity: 'negative' },
  // 习惯：我每天X / 我习惯X / 我一般X / 我通常X
  { re: /我(?:每天|每日|习惯|一般|通常|经常|总是|都会|会)\s*(.{2,20}?)(?:[。，,\s]|$)/g, polarity: 'habit' },
  // 当前状态：我最近X / 我现在X / 我在X
  { re: /我(?:最近|现在|正在|在)\s*(.{2,20}?)(?:[。，,\s]|$)/g, polarity: 'recent' },
];

/**
 * 对 Cecelia 的行为纠正模式
 */
const CORRECTION_PATTERNS = [
  /你(?:应该|要|需要|得|必须)\s*(.{2,30}?)(?:[。，,\s]|$)/g,
  /你(?:不应该|不要|别|不能|不该|不必|不用)\s*(.{2,30}?)(?:[。，,\s]|$)/g,
  /下次(?:你|应该|要|别|不要)\s*(.{2,30}?)(?:[。，,\s]|$)/g,
  /以后(?:你|应该|要|别|不要)\s*(.{2,30}?)(?:[。，,\s]|$)/g,
];

/**
 * 噪音过滤：纯语气词/动作词，不含实质内容
 */
const NOISE_VALUES = new Set([
  '这样', '那样', '这么', '那么', '这', '那', '它', '他', '她',
  '好', '好的', '嗯', '哦', '啊', '哈', '行', '对', '是', '对的',
  '继续', '去做', '执行', '处理', '看看', '查一下',
]);

const MIN_VALUE_LENGTH = 2;
const MAX_VALUE_LENGTH = 20;

// ─────────────────────────────────────────────
// 2. 动态词库缓存
// ─────────────────────────────────────────────

// personId → { keywords: [{keyword, polarity}], loadedAt: Date }
const _keywordCache = new Map();
const KEYWORD_CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟

/**
 * 从 learned_keywords 表加载动态词库（内存缓存，5分钟 TTL）
 * @param {Object} pool
 * @param {string} personId
 * @returns {Promise<Array<{keyword: string, polarity: string}>>}
 */
export async function loadLearnedKeywords(pool, personId) {
  const cached = _keywordCache.get(personId);
  if (cached && (Date.now() - cached.loadedAt) < KEYWORD_CACHE_TTL_MS) {
    return cached.keywords;
  }

  try {
    const { rows } = await pool.query(
      `SELECT keyword, polarity FROM learned_keywords
       WHERE person_id = $1
       ORDER BY use_count DESC, last_seen_at DESC
       LIMIT 200`,
      [personId]
    );
    const keywords = rows.map(r => ({ keyword: r.keyword, polarity: r.polarity }));
    _keywordCache.set(personId, { keywords, loadedAt: Date.now() });
    return keywords;
  } catch (err) {
    console.warn('[fact-extractor] loadLearnedKeywords failed:', err.message);
    return [];
  }
}

/**
 * 刷新指定 person 的词库缓存（Haiku 写入新词后调用）
 * @param {string} personId
 */
export function invalidateKeywordCache(personId) {
  _keywordCache.delete(personId);
}

// ─────────────────────────────────────────────
// 3. 提取函数
// ─────────────────────────────────────────────

/**
 * 从消息文本中提取事实（正则 + 动态词库）
 * @param {string} message
 * @param {Array<{keyword: string, polarity: string}>} [learnedKeywords=[]] - 从 DB 加载的动态词库
 * @returns {{ preferences: Array, corrections: Array }}
 */
export function extractFacts(message, learnedKeywords = []) {
  if (!message || message.trim().length < 3) {
    return { preferences: [], corrections: [] };
  }

  const text = message.trim();
  const preferences = [];
  const corrections = [];

  // 提取偏好/习惯（静态正则）
  for (const { re, polarity } of PREFERENCE_PATTERNS) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
      // group 1 可能是极性词（正向模式），group 2 是对象；负向模式只有 group 1（对象）
      const value = (match[2] || match[1] || '').trim();
      if (isValidValue(value)) {
        preferences.push({
          value,
          polarity,
          raw: match[0].trim(),
          temporal: detectTemporal(text),
          source: 'regex',
        });
      }
    }
  }

  // 动态词库匹配（learned_keywords 加速命中）
  if (learnedKeywords.length > 0) {
    const existingValues = new Set(preferences.map(p => p.value));
    for (const { keyword, polarity } of learnedKeywords) {
      if (text.includes(keyword) && !existingValues.has(keyword)) {
        existingValues.add(keyword);
        preferences.push({
          value: keyword,
          polarity,
          raw: keyword,
          temporal: detectTemporal(text),
          source: 'learned',
        });
      }
    }
  }

  // 提取对 Cecelia 的纠正
  for (const re of CORRECTION_PATTERNS) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
      const value = (match[1] || '').trim();
      if (isValidValue(value)) {
        corrections.push({
          value,
          raw: match[0].trim(),
        });
      }
    }
  }

  return { preferences, corrections };
}

function isValidValue(value) {
  if (!value) return false;
  if (value.length < MIN_VALUE_LENGTH || value.length > MAX_VALUE_LENGTH) return false;
  if (NOISE_VALUES.has(value)) return false;
  // 过滤纯标点
  if (/^[。，,.!！?？\s]+$/.test(value)) return false;
  return true;
}

function detectTemporal(text) {
  if (/最近|近期|这段时间|这几天|最近一段/.test(text)) return 'recent';
  if (/以后|未来|将来|以前|过去|曾经/.test(text)) return 'historical';
  return 'current';
}

// ─────────────────────────────────────────────
// 4. Haiku 提取层
// ─────────────────────────────────────────────

/**
 * 用 Haiku 提取消息中的偏好，找到正则漏掉的 gap，写入 learned_keywords
 * @param {string} message
 * @param {Array} regexPrefs - 正则已提取的偏好列表
 * @param {Object} pool
 * @param {string} personId
 * @param {Function} callLLMFn - callLLM(agentId, prompt, options) 函数
 * @returns {Promise<Array>} - Haiku 补充的额外偏好（不含正则已有的）
 */
export async function extractFactsWithHaiku(message, regexPrefs, pool, personId, callLLMFn) {
  const prompt = `从以下消息中提取用户的偏好、习惯和当前状态。

消息："${message}"

请以 JSON 格式返回，格式如下：
{
  "preferences": [
    {"value": "咖啡", "polarity": "positive"},
    {"value": "早起", "polarity": "habit"}
  ]
}

规则：
- polarity 只能是: "positive"（喜欢）, "negative"（不喜欢）, "habit"（习惯）, "recent"（最近状态）
- value 只保留核心关键词（2-10字），不含"喜欢"、"我"等结构词
- 如果没有发现任何偏好，返回 {"preferences": []}
- 只返回 JSON，不要其他文字`;

  let haikuPrefs = [];
  try {
    const { text } = await callLLMFn('fact_extractor', prompt, { timeout: 15000, maxTokens: 256 });
    const parsed = parseHaikuJSON(text);
    haikuPrefs = (parsed?.preferences || []).filter(p =>
      p && p.value && isValidValue(p.value) &&
      ['positive', 'negative', 'habit', 'recent'].includes(p.polarity)
    );
  } catch (err) {
    console.warn('[fact-extractor] Haiku 提取失败，降级到正则结果:', err.message);
    return [];
  }

  // 找到 gap：Haiku 有但正则没有的 keywords
  const regexValueSet = new Set(regexPrefs.map(p => p.value));
  const gaps = haikuPrefs.filter(p => !regexValueSet.has(p.value));

  // 写入 learned_keywords（反哺词库）
  if (gaps.length > 0) {
    await saveLearnedKeywords(pool, personId, gaps).catch(err =>
      console.warn('[fact-extractor] saveLearnedKeywords failed:', err.message)
    );
    invalidateKeywordCache(personId);
  }

  // 保存 Haiku 找到的额外偏好到 person_signals
  if (gaps.length > 0) {
    const extraPrefs = gaps.map(p => ({
      value: p.value,
      polarity: p.polarity,
      raw: p.value,
      temporal: detectTemporal(message),
      source: 'haiku',
    }));
    await savePreferences(pool, personId, extraPrefs).catch(err =>
      console.warn('[fact-extractor] savePreferences(haiku) failed:', err.message)
    );
  }

  return gaps;
}

/**
 * 解析 Haiku 返回的 JSON（容错处理）
 */
function parseHaikuJSON(text) {
  if (!text) return null;
  // 尝试直接解析
  try {
    return JSON.parse(text.trim());
  } catch { /* continue */ }
  // 尝试提取 JSON block
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch { /* continue */ }
  }
  return null;
}

/**
 * 将 gap keywords 写入 learned_keywords（ON CONFLICT 更新 use_count + last_seen_at）
 * @param {Object} pool
 * @param {string} personId
 * @param {Array<{value: string, polarity: string}>} keywords
 */
export async function saveLearnedKeywords(pool, personId, keywords) {
  if (!keywords || keywords.length === 0) return;

  for (const kw of keywords) {
    try {
      await pool.query(
        `INSERT INTO learned_keywords (person_id, keyword, polarity, source, use_count, last_seen_at)
         VALUES ($1, $2, $3, 'haiku', 1, NOW())
         ON CONFLICT (person_id, keyword) DO UPDATE
           SET use_count    = learned_keywords.use_count + 1,
               last_seen_at = NOW()`,
        [personId, kw.value, kw.polarity]
      );
      console.log(`[fact-extractor] 学习关键词: "${kw.value}" (${kw.polarity})`);
    } catch (err) {
      console.warn('[fact-extractor] saveLearnedKeywords row failed:', err.message);
    }
  }
}

// ─────────────────────────────────────────────
// 5. 存储函数
// ─────────────────────────────────────────────

/**
 * 将提取到的用户偏好写入 person_signals
 * @param {Object} pool
 * @param {string} personId - feishu open_id 或 'owner'
 * @param {Array} preferences
 */
export async function savePreferences(pool, personId, preferences) {
  if (!preferences || preferences.length === 0) return;

  for (const pref of preferences) {
    try {
      const decayTier = pref.temporal === 'recent' ? 'weekly' : 'permanent';
      const confidence = pref.polarity === 'habit' ? 0.9 : 0.8;

      // 去重：same person_id + signal_type + signal_value 内 7 天内不重复写入
      const existing = await pool.query(
        `SELECT id FROM person_signals
         WHERE person_id = $1
           AND signal_type = 'preference'
           AND signal_value = $2
           AND created_at > NOW() - INTERVAL '7 days'
         LIMIT 1`,
        [personId, pref.value]
      );
      if (existing.rows.length > 0) continue;

      await pool.query(
        `INSERT INTO person_signals
           (person_id, signal_type, signal_value, confidence, source, decay_tier, raw_excerpt, created_at)
         VALUES ($1, 'preference', $2, $3, 'explicit', $4, $5, NOW())`,
        [personId, pref.value, confidence, decayTier, pref.raw]
      );
      console.log(`[fact-extractor] 偏好已记录: ${personId} ${pref.polarity} "${pref.value}"`);
    } catch (err) {
      console.warn('[fact-extractor] savePreferences failed:', err.message);
    }
  }
}

/**
 * 将行为纠正写入 learnings(category='behavior_correction')
 * @param {Object} pool
 * @param {Array} corrections
 * @param {string} rawMessage - 原始消息（存为 trigger_event 上下文）
 */
export async function saveCorrections(pool, corrections, rawMessage) {
  if (!corrections || corrections.length === 0) return;

  const { createHash } = await import('crypto');

  for (const correction of corrections) {
    try {
      const title = `行为纠正：${correction.value.slice(0, 40)}`;
      const content = `Alex 说：「${correction.raw}」`;
      const contentHash = createHash('sha256')
        .update(`${title}\n${content}`)
        .digest('hex')
        .slice(0, 16);

      // 去重
      const existing = await pool.query(
        'SELECT id FROM learnings WHERE content_hash = $1 AND is_latest = true LIMIT 1',
        [contentHash]
      );
      if (existing.rows.length > 0) continue;

      await pool.query(
        `INSERT INTO learnings
           (title, content, summary, category, trigger_event, content_hash, version, is_latest, digested)
         VALUES ($1, $2, $3, 'behavior_correction', $4, $5, 1, true, false)`,
        [title, content, title, rawMessage?.slice(0, 100) || '', contentHash]
      );
      console.log(`[fact-extractor] 行为纠正已记录: "${correction.value}"`);
    } catch (err) {
      console.warn('[fact-extractor] saveCorrections failed:', err.message);
    }
  }
}

// ─────────────────────────────────────────────
// 6. 矛盾检测
// ─────────────────────────────────────────────

/**
 * 检测新偏好是否与已有偏好矛盾（饮品、食物等"单选"类别）
 * 矛盾标准：同类别的不同 positive 偏好（非并存型）
 *
 * @param {Object} pool
 * @param {string} personId
 * @param {Array} newPreferences
 * @returns {Promise<Array>} contradictions
 */
export async function detectContradictions(pool, personId, newPreferences) {
  const contradictions = [];

  // 只检测正向偏好的矛盾（"喜欢X" vs "喜欢Y"）
  const positive = newPreferences.filter(p => p.polarity === 'positive');
  if (positive.length === 0) return contradictions;

  for (const pref of positive) {
    try {
      // 找同类别的已有 positive 偏好（基于关键词类别判断）
      const category = inferCategory(pref.value);
      if (!category) continue; // 无法分类的，不检测矛盾

      // 查找同类别已有偏好
      const existing = await pool.query(
        `SELECT signal_value, raw_excerpt FROM person_signals
         WHERE person_id = $1
           AND signal_type = 'preference'
           AND created_at > NOW() - INTERVAL '30 days'
           AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY created_at DESC
         LIMIT 20`,
        [personId]
      );

      for (const row of existing.rows) {
        const existingCategory = inferCategory(row.signal_value);
        if (existingCategory !== category) continue;
        if (row.signal_value === pref.value) continue; // 同值不算矛盾

        // 同类别不同值 → 矛盾
        contradictions.push({
          newValue: pref.value,
          existingValue: row.signal_value,
          category,
        });
        break; // 每个新偏好最多报一个矛盾
      }
    } catch (err) {
      console.warn('[fact-extractor] detectContradictions failed:', err.message);
    }
  }

  return contradictions;
}

/**
 * 将矛盾写入 pending_conversations，下次 Cecelia 对话时主动问 Alex
 * @param {Object} pool
 * @param {string} personId
 * @param {Array} contradictions
 */
export async function saveClarificationRequests(pool, personId, contradictions) {
  if (!contradictions || contradictions.length === 0) return;

  for (const c of contradictions) {
    try {
      const message = `我之前记得你喜欢「${c.existingValue}」，现在又说喜欢「${c.newValue}」——是两个都喜欢，还是现在换了？`;
      const context = `preference_contradiction:${c.category}`;

      // 检查是否已有同类澄清请求待处理
      const existing = await pool.query(
        `SELECT id FROM pending_conversations
         WHERE person_id = $1
           AND context_type = 'clarification'
           AND context = $2
           AND resolved_at IS NULL
         LIMIT 1`,
        [personId, context]
      );
      if (existing.rows.length > 0) continue;

      await pool.query(
        `INSERT INTO pending_conversations
           (person_id, message, context, context_type, importance, sent_at)
         VALUES ($1, $2, $3, 'clarification', 0.8, NOW())`,
        [personId, message, context]
      );
      console.log(`[fact-extractor] 矛盾澄清请求已记录: ${c.existingValue} vs ${c.newValue}`);
    } catch (err) {
      console.warn('[fact-extractor] saveClarificationRequests failed:', err.message);
    }
  }
}

// ─────────────────────────────────────────────
// 7. 类别推断（用于矛盾检测）
// ─────────────────────────────────────────────

const CATEGORY_MAP = [
  { category: 'drink', keywords: ['咖啡', '茶', '绿茶', '红茶', '奶茶', '果汁', '可乐', '牛奶', '豆浆', '水', '酒', '啤酒'] },
  { category: 'food', keywords: ['米饭', '面', '面包', '饺子', '包子', '沙拉', '肉', '素食', '甜食', '辣', '川菜', '粤菜'] },
  { category: 'color', keywords: ['蓝色', '红色', '绿色', '黑色', '白色', '黄色', '紫色', '橙色', '粉色', '灰色'] },
  { category: 'music', keywords: ['音乐', '流行', '古典', '爵士', '摇滚', '说唱', '民谣', '电子'] },
  { category: 'sport', keywords: ['跑步', '游泳', '骑车', '健身', '篮球', '足球', '网球', '瑜伽'] },
  { category: 'work_time', keywords: ['早上工作', '晚上工作', '下午工作', '早起', '熬夜', '午休'] },
];

// 颜色可以并存（喜欢蓝色 AND 红色），不算矛盾
const NON_EXCLUSIVE_CATEGORIES = new Set(['color', 'music']);

function inferCategory(value) {
  if (!value) return null;
  for (const { category, keywords } of CATEGORY_MAP) {
    if (keywords.some(k => value.includes(k))) {
      if (NON_EXCLUSIVE_CATEGORIES.has(category)) return null; // 可并存，不检测矛盾
      return category;
    }
  }
  return null;
}

// ─────────────────────────────────────────────
// 8. 主入口（orchestrator-chat.js 调用）
// ─────────────────────────────────────────────

/**
 * 处理一条用户消息，完成混合事实捕获 + 矛盾检测
 * fire-and-forget，失败静默
 *
 * @param {Object} pool
 * @param {string} personId
 * @param {string} message - 用户消息原文
 * @param {Function|null} [callLLMFn=null] - callLLM 函数（提供则启用 Haiku 层）
 */
export async function processMessageFacts(pool, personId, message, callLLMFn = null) {
  try {
    // 1. 加载动态词库（Haiku 之前反哺的 learned keywords）
    const learnedKeywords = await loadLearnedKeywords(pool, personId);

    // 2. 正则提取（含动态词库加速）
    const { preferences: regexPrefs, corrections } = extractFacts(message, learnedKeywords);

    // 3. 并行：保存正则偏好 + 矛盾检测 + 保存纠正
    if (regexPrefs.length > 0 || corrections.length > 0) {
      const [contradictions] = await Promise.all([
        detectContradictions(pool, personId, regexPrefs),
        savePreferences(pool, personId, regexPrefs),
        saveCorrections(pool, corrections, message),
      ]);

      if (contradictions.length > 0) {
        await saveClarificationRequests(pool, personId, contradictions);
      }
    }

    // 4. Haiku 层（fire-and-forget，不等待）
    if (callLLMFn) {
      extractFactsWithHaiku(message, regexPrefs, pool, personId, callLLMFn)
        .catch(err => console.warn('[fact-extractor] Haiku layer error:', err.message));
    }
  } catch (err) {
    console.warn('[fact-extractor] processMessageFacts failed:', err.message);
  }
}
