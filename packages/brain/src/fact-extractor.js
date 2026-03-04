/**
 * fact-extractor.js — 脚本级事实捕获（无 LLM，无门槛）
 *
 * 职责：
 *   1. 从每条对话消息里用正则捕获显式事实
 *   2. 用户偏好/习惯 → person_signals (signal_type='preference', decay_tier='permanent')
 *   3. 对 Cecelia 的行为纠正 → learnings (category='behavior_correction')
 *   4. 新事实与已有同类比对，发现矛盾 → pending_conversations 请求澄清
 *
 * 设计原则：
 *   - 只用正则，不调 LLM（零延迟、零成本）
 *   - 宁可漏掉，不要误报（conservative 模式）
 *   - fire-and-forget 调用，失败静默
 */

/* global console */

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
// 2. 提取函数
// ─────────────────────────────────────────────

/**
 * 从消息文本中提取事实
 * @param {string} message
 * @returns {{ preferences: Array, corrections: Array }}
 */
export function extractFacts(message) {
  if (!message || message.trim().length < 3) {
    return { preferences: [], corrections: [] };
  }

  const text = message.trim();
  const preferences = [];
  const corrections = [];

  // 提取偏好/习惯
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
// 3. 存储函数
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
// 4. 矛盾检测
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
// 5. 类别推断（用于矛盾检测）
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
// 6. 主入口（orchestrator-chat.js 调用）
// ─────────────────────────────────────────────

/**
 * 处理一条用户消息，完成事实捕获 + 矛盾检测
 * fire-and-forget，失败静默
 *
 * @param {Object} pool
 * @param {string} personId
 * @param {string} message - 用户消息原文
 */
export async function processMessageFacts(pool, personId, message) {
  try {
    const { preferences, corrections } = extractFacts(message);

    if (preferences.length === 0 && corrections.length === 0) return;

    // 并行：保存偏好 + 矛盾检测 + 保存纠正
    const [contradictions] = await Promise.all([
      detectContradictions(pool, personId, preferences),
      savePreferences(pool, personId, preferences),
      saveCorrections(pool, corrections, message),
    ]);

    if (contradictions.length > 0) {
      await saveClarificationRequests(pool, personId, contradictions);
    }
  } catch (err) {
    console.warn('[fact-extractor] processMessageFacts failed:', err.message);
  }
}
