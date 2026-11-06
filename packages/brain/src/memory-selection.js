// ============================================================
// 常量配置
// ============================================================

/** 各数据源的时间衰减半衰期（天） */
export const HALF_LIFE = {
  task: 30,
  learning: 90,
  event: 1,
  conversation: 7,
  okr: Infinity,
  capability: Infinity,
  kr: Infinity,
  initiative: 180,
  project: Infinity,
};

/** 各模式下各数据源的权重 */
export const MODE_WEIGHT = {
  task:         { plan: 1.0, execute: 1.2, debug: 1.0, chat: 0.8 },
  learning:     { plan: 0.8, execute: 1.0, debug: 1.5, chat: 0.6 },
  event:        { plan: 0.5, execute: 0.8, debug: 1.5, chat: 0.3 },
  conversation: { plan: 0.3, execute: 0.3, debug: 0.3, chat: 1.5 },
  okr:          { plan: 1.5, execute: 0.5, debug: 0.3, chat: 1.0 },
  capability:   { plan: 1.0, execute: 0.8, debug: 0.5, chat: 0.5 },
  kr:           { plan: 1.5, execute: 0.8, debug: 0.3, chat: 1.2 },
  initiative:   { plan: 1.2, execute: 1.5, debug: 0.5, chat: 1.3 },
  project:      { plan: 1.3, execute: 0.6, debug: 0.3, chat: 1.0 },
};

/** 默认 token 预算 */
const DEFAULT_TOKEN_BUDGET = 800;

/**
 * salience_score 加权因子
 * finalScore × (1 + salience_score × SALIENCE_WEIGHT)
 * salience=1.0 时最多提升 50% 评分；salience=0 时不影响评分（向后兼容）
 */
export const SALIENCE_WEIGHT = 0.5;

/** Chat 模式 token 预算（对话场景需要更丰富的上下文） */
export const CHAT_TOKEN_BUDGET = 2500;

/**
 * Source 配额约束
 * - min: 至少注入 N 条（有候选时保证）
 * - max: 最多注入 N 条（防止某一类型占满）
 */
export const SOURCE_QUOTA = {
  conversation: { max: 4 },
  task:         { min: 2 },
  learning:     { min: 2 },
  kr:           { max: 3 },
  initiative:   { max: 3 },
  project:      { max: 2 },
};

/**
 * 意图类型 → 动态权重倍数（叠加在 MODE_WEIGHT 之上）
 * 消息关键词分类后，对应 source 的 finalScore 乘以该倍数
 */
export const INTENT_WEIGHT_MULTIPLIER = {
  task_focused: {
    task: 1.5, okr: 1.5, kr: 1.5, initiative: 1.5, project: 1.2, conversation: 0.6,
  },
  emotion_focused: {
    conversation: 1.5, learning: 1.2, task: 0.6,
  },
  learning_focused: {
    learning: 2.0, conversation: 0.8,
  },
  default: {},
};

/**
 * 意图分类关键词
 */
const INTENT_KEYWORDS = {
  task_focused: ['任务', 'kr', 'okr', '进展', '目标', '工作', '完成', '派发', '执行', '进度', '截止', '计划', '项目', '开发', '实现'],
  emotion_focused: ['感受', '情绪', '想法', '心情', '觉得', '开心', '难过', '压力', '焦虑', '高兴', '失落', '担心', '开心', '疲惫'],
  learning_focused: ['学到', '记录', '经验', '总结', '教训', '发现', '洞察', '反思', '收获', '体会', '学习', '成长'],
};

/**
 * 根据当前查询和最近对话历史，判断话题深度
 * 0 = 首次提及；1 = 延伸讨论（已聊过）；2 = 深度下钻（多轮连续）
 * @param {string} query - 当前查询
 * @param {Array} conversationEntries - loadConversationHistory 返回的 entries
 * @returns {0|1|2}
 */
export function computeTopicDepth(query, conversationEntries) {
  if (!conversationEntries || conversationEntries.length === 0) return 0;

  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return 0;

  const recent = conversationEntries.slice(0, 5);
  let matchCount = 0;

  for (const entry of recent) {
    // 只比对用户消息部分（entry.title 是 "[对话] userMsg前60字"，去掉前缀）
    // 不含 Cecelia 回复，避免回复文本撑大 union 导致 Jaccard 偏低
    const userPart = entry.title
      ? entry.title.replace(/^\[对话\]\s*/, '')
      : (entry.text || '').split('\nCecelia:')[0].replace(/^Alex:\s*/, '');
    const entryText = userPart || `${entry.title || ''} ${entry.description || ''}`;
    const entryTokens = new Set(tokenize(entryText));
    if (entryTokens.size === 0) continue;

    const intersection = [...queryTokens].filter(t => entryTokens.has(t)).length;
    const union = new Set([...queryTokens, ...entryTokens]).size;
    if (intersection / union >= 0.15) matchCount++;
  }

  if (matchCount >= 3) return 2;
  if (matchCount >= 1) return 1;
  return 0;
}

/**
 * 根据查询文本分类意图
 * @param {string} query - 查询文本
 * @returns {'task_focused'|'emotion_focused'|'learning_focused'|'default'} 意图类型
 */
export function classifyQueryIntent(query) {
  if (!query) return 'default';
  const lower = query.toLowerCase();

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return intent;
    }
  }
  return 'default';
}

/**
 * Quota-aware 候选选择
 *
 * 两阶段选择：
 * 1. 保证每个 source 的最小配额（从原始 scored 列表中补充）
 * 2. 剩余空间按 finalScore 填充，但 conversation 不超过 max
 *
 * @param {Array} deduped - MMR 重排后的候选（多样性最优）
 * @param {Array} scored - 所有评分候选（用于补充最小配额）
 * @returns {Array} 经过配额约束的候选列表
 */
export function quotaAwareSelect(deduped, scored) {
  const quotaCount = {};
  const selectedIds = new Set();
  const result = [];

  // Phase 1: 从 deduped 列表依次添加，跳过超 max 配额的
  for (const item of deduped) {
    const src = item.source;
    const count = quotaCount[src] || 0;
    const quota = SOURCE_QUOTA[src];
    if (quota && quota.max !== undefined && count >= quota.max) continue;
    quotaCount[src] = count + 1;
    selectedIds.add(item.id);
    result.push(item);
  }

  // Phase 2: 检查每个有最小配额的 source 是否已满足
  for (const [source, quota] of Object.entries(SOURCE_QUOTA)) {
    if (!quota.min) continue;
    const current = quotaCount[source] || 0;
    if (current >= quota.min) continue;

    // 需要从 scored 里补充
    const needed = quota.min - current;
    const extras = scored
      .filter(s => s.source === source && !selectedIds.has(s.id))
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, needed);

    for (const item of extras) {
      selectedIds.add(item.id);
      result.push(item);
    }
  }

  return result;
}

// ============================================================
// 内部辅助：错误分类 + 禁用占位
// ============================================================

/**
 * 根据错误信息分类 fetchStatus
 * @param {Error} err
 * @returns {'pool_exhausted'|'db_error'}
 */
function _classifyError(err) {
  const msg = (err && err.message) || '';
  if (msg.includes('too many clients')) return 'pool_exhausted';
  return 'db_error';
}

/**
 * 当某路查询被 strategy 禁用时返回的占位结果
 * @returns {{ entries: Array, meta: Object }}
 */
function _disabledResult() {
  return {
    entries: [],
    meta: { requestedLimit: 0, fetchedCount: 0, fetchStatus: 'disabled', candidateCount: 0 },
  };
}

/** 事件记忆中感兴趣的 event types */
const RELEVANT_EVENT_TYPES = [
  'task_failed',
  'task_completed',
  'alert',
  'layer2_health',
  'escalation',
  'llm_api_error',
  'llm_bad_output',
  'orchestrator_chat',
];

// ============================================================
// 核心函数
// ============================================================

/**
 * 时间衰减函数
 * decay(age) = exp(-age_days * ln(2) / half_life)
 * @param {string|Date} createdAt - 创建时间
 * @param {number} halfLifeDays - 半衰期天数（Infinity = 不衰减）
 * @returns {number} 0-1 之间的衰减因子
 */
export function timeDecay(createdAt, halfLifeDays) {
  if (!halfLifeDays || halfLifeDays === Infinity || !createdAt) return 1;
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / 86400000;
  if (ageDays <= 0) return 1;
  return Math.exp(-ageDays * Math.LN2 / halfLifeDays);
}

/**
 * 简单 Jaccard 去重：高分优先，后续候选与已选结果 Jaccard > threshold 的丢弃
 * （Phase 1 遗留，保留向后兼容；Phase 3 主流程已改用 mmrRerank）
 * @param {Array} scored - 已评分的候选列表（需有 text 和 finalScore）
 * @param {number} threshold - Jaccard 阈值（默认 0.8）
 * @returns {Array} 去重后的列表
 */
export function simpleDedup(scored, threshold = 0.8) {
  const sorted = [...scored].sort((a, b) => b.finalScore - a.finalScore);
  const result = [];
  for (const item of sorted) {
    const isDuplicate = result.some(r => jaccardSimilarity(r.text, item.text) > threshold);
    if (!isDuplicate) result.push(item);
  }
  return result;
}

/**
 * MMR (Maximal Marginal Relevance) 重排
 *
 * 平衡相关性和多样性：
 * MMR(i) = lambda * relevance(i) - (1 - lambda) * max_similarity(i, selected)
 *
 * @param {Array} candidates - 已评分的候选列表（需有 text 和 finalScore）
 * @param {number} topK - 返回的最大条数
 * @param {number} lambda - 平衡因子（0-1，越大越偏相关性，默认 0.7）
 * @returns {Array} MMR 重排后的列表
 */
export function mmrRerank(candidates, topK, lambda = 0.7) {
  if (!candidates || candidates.length === 0) return [];
  if (topK <= 0) return [];

  const selected = [];
  const remaining = [...candidates];

  // 归一化 finalScore 到 0-1（避免不同数据源分数量纲差异）
  const maxScore = Math.max(...remaining.map(r => r.finalScore), 0.001);

  while (selected.length < topK && remaining.length > 0) {
    let bestIdx = 0;
    let bestMMR = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const relevance = remaining[i].finalScore / maxScore;
      const maxSim = selected.length > 0
        ? Math.max(...selected.map(s => jaccardSimilarity(s.text, remaining[i].text)))
        : 0;
      const mmr = lambda * relevance - (1 - lambda) * maxSim;

      if (mmr > bestMMR) {
        bestMMR = mmr;
        bestIdx = i;
      }
    }

    selected.push(remaining.splice(bestIdx, 1)[0]);
  }

  return selected;
}

/**
 * 计算两段文本的 Jaccard 相似度
 * @param {string} textA
 * @param {string} textB
 * @returns {number} 0-1
 */
export function jaccardSimilarity(textA, textB) {
  if (!textA || !textB) return 0;
  const tokensA = new Set(tokenize(textA));
  const tokensB = new Set(tokenize(textB));
  if (tokensA.size === 0 && tokensB.size === 0) return 0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * 简单分词（中英文混合）
 */
function tokenize(text) {
  if (!text) return [];
  const cleaned = text.toLowerCase().replace(/[^\w\s\u4e00-\u9fa5]/g, ' ');
  const tokens = [];
  // 英文/数字：按空格切分，过滤长度 > 1
  for (const word of cleaned.split(/\s+/)) {
    if (!word) continue;
    if (/[\u4e00-\u9fa5]/.test(word)) {
      // 中文：逐字符切分（避免整段变一个大 token 导致 Jaccard 退化）
      for (const ch of word) {
        if (/[\u4e00-\u9fa5]/.test(ch)) tokens.push(ch);
      }
    } else if (word.length > 1) {
      tokens.push(word);
    }
  }
  return tokens;
}

/**
 * 简单 token 估算：中英文混合文本约 2.5 字符/token
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 2.5);
}

/**
 * 判断查询是否与 OKR/任务/项目相关，用于决定是否注入 WORLD_STATE
 * @param {string} query
 * @returns {boolean}
 */
export function isWorldStateQuery(query) {
  if (!query) return false;
  return /OKR|目标|KR|关键结果|项目|任务|计划|平台|进度|完成|执行|initiative|objective|key result|project|task/i.test(query);
}

const SOURCE_LABEL = {
  task: '任务',
  learning: '经验',
  event: '事件',
  capability: '能力',
  kr: 'KR目标',
  initiative: 'Initiative',
  project: '项目容器',
  okr: 'OKR',
};

function _buildExtras(item) {
  const extras = [];
  if (item.task_count != null) extras.push(`关联任务 ${item.task_count} 个`);
  if (item.parent_kr_title) extras.push(`所属KR: ${item.parent_kr_title}`);
  return extras;
}

function _getPreviewBase(item, depth) {
  if (depth === 0) return (item.description || item.text || '').slice(0, 80);
  if (depth === 1) return (item.description || item.text || '').slice(0, 250);
  return item.full_content || item.description || item.text || '';
}

/**
 * 格式化单条记忆项
 * @param {Object} item - 候选记忆
 * @param {0|1|2} [depth=0] - 对话深度：0=L0简短，1=L1详情，2=全文
 * @returns {string}
 */
function formatItem(item, depth = 0) {
  const label = SOURCE_LABEL[item.source] || item.source;
  const title = (item.title || '').slice(0, 80);
  const statusHint = item.status ? ` (${item.status})` : '';
  const base = _getPreviewBase(item, depth);
  const extras = depth === 0 ? [] : _buildExtras(item);
  const preview = extras.length ? `${base} [${extras.join('，')}]` : base;
  return `- [${label}] **${title}**${statusHint}: ${preview}`;
}

export { DEFAULT_TOKEN_BUDGET, _classifyError, _disabledResult, RELEVANT_EVENT_TYPES, formatItem, tokenize };
