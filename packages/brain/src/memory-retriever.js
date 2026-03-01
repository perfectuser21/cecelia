/**
 * Memory Retriever - 统一记忆检索器
 *
 * 三层记忆模型：
 * - 语义记忆 (Semantic): tasks + learnings + capabilities 的向量搜索
 * - 事件记忆 (Episodic): cecelia_events 时间窗口 + type 过滤
 * - 画像配置 (Profile): OKR 目标 + 能力摘要（不衰减）
 *
 * 统一入口：buildMemoryContext({query, mode, tokenBudget, pool})
 * 替代 thalamus 原有的双注入逻辑（learningBlock + memoryBlock）
 */

/* global console */

import SimilarityService from './similarity.js';
import { searchRelevantLearnings } from './learning.js';
import { routeMemory } from './memory-router.js';
import { generateL0Summary } from './memory-utils.js';
import { generateEmbedding } from './openai-client.js';

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
};

/** 各模式下各数据源的权重 */
export const MODE_WEIGHT = {
  task:         { plan: 1.0, execute: 1.2, debug: 1.0, chat: 0.8 },
  learning:     { plan: 0.8, execute: 1.0, debug: 1.5, chat: 0.6 },
  event:        { plan: 0.5, execute: 0.8, debug: 1.5, chat: 0.3 },
  conversation: { plan: 0.3, execute: 0.3, debug: 0.3, chat: 1.5 },
  okr:          { plan: 1.5, execute: 0.5, debug: 0.3, chat: 1.0 },
  capability:   { plan: 1.0, execute: 0.8, debug: 0.5, chat: 0.5 },
};

/** 默认 token 预算 */
const DEFAULT_TOKEN_BUDGET = 800;

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
};

/**
 * 意图类型 → 动态权重倍数（叠加在 MODE_WEIGHT 之上）
 * 消息关键词分类后，对应 source 的 finalScore 乘以该倍数
 */
export const INTENT_WEIGHT_MULTIPLIER = {
  task_focused: {
    task: 1.5, okr: 1.5, conversation: 0.6,
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
  return text.toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fa5]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
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
 * 格式化单条记忆项为简短摘要
 * @param {Object} item - 候选记忆
 * @returns {string}
 */
function formatItem(item) {
  const sourceLabel = {
    task: '任务',
    learning: '经验',
    event: '事件',
    capability: '能力',
  };
  const label = sourceLabel[item.source] || item.source;
  const title = (item.title || '').slice(0, 80);
  const preview = (item.description || item.text || '').slice(0, 120);
  return `- [${label}] **${title}**: ${preview}`;
}

// ============================================================
// 数据源适配器
// ============================================================

/**
 * 语义记忆检索：tasks + learnings（向量/Jaccard 混合搜索）
 * @param {Object} pool - pg pool
 * @param {string} query - 搜索文本
 * @param {string} mode - 模式
 * @returns {Promise<Array>} 候选列表
 */
async function searchSemanticMemory(pool, query, mode) {
  const candidates = [];

  // 1. 搜索 tasks + capabilities（向量搜索）
  try {
    const similarity = new SimilarityService(pool);
    const results = await similarity.searchWithVectors(query, {
      topK: 20,
      fallbackToJaccard: true,
    });
    for (const m of (results.matches || [])) {
      candidates.push({
        id: m.id,
        source: m.level === 'capability' ? 'capability' : 'task',
        title: m.title || '',
        description: m.description || '',
        text: `${m.title || ''} ${m.description || ''}`,
        relevance: m.score || 0,
        created_at: m.created_at || null,
        status: m.status,
      });
    }
  } catch (err) {
    console.warn('[memory-retriever] Semantic search failed (graceful fallback):', err.message);
  }

  // 2. 搜索 learnings（当前关键词匹配，Phase 2 升级为向量）
  try {
    const learnings = await searchRelevantLearnings({
      description: query,
      task_type: null,
      failure_class: null,
      event_type: null,
    }, 10);
    for (const l of learnings) {
      candidates.push({
        id: l.id,
        source: 'learning',
        title: l.title || '',
        description: (typeof l.content === 'string' ? l.content : JSON.stringify(l.content || '')).slice(0, 300),
        text: `${l.title || ''} ${l.content || ''}`,
        relevance: (l.relevance_score || 0) / 30, // 归一化到 0-1 范围（max score ≈ 30）
        created_at: l.created_at || null,
      });
    }
  } catch (err) {
    console.warn('[memory-retriever] Learnings search failed (graceful fallback):', err.message);
  }

  return candidates;
}

// ============================================================
// L0/L1 分层记忆工具
// ============================================================

// generateL0Summary 来自 memory-utils.js（避免循环依赖）
export { generateL0Summary };

/**
 * 片段记忆检索（Episodic Memory）：向量优先，Jaccard 降级
 *
 * 向量路径（优先）：
 *   1. 生成 query embedding
 *   2. pgvector cosine 相似度检索 memory_stream（embedding IS NOT NULL）
 *   3. L1 展开：token 预算截断
 *
 * Jaccard 降级（无 OPENAI_API_KEY 或无向量数据时）：
 *   L0: summary/content 前100字 Jaccard 过滤
 *   L1: 展开 content，token 截断
 *
 * @param {Object} pool - pg pool
 * @param {string} query - 搜索文本
 * @param {number} [tokenBudget=300] - token 预算
 * @returns {Promise<Array>} 候选列表（source='episodic'）
 */
export async function searchEpisodicMemory(pool, query, tokenBudget = 300) {
  if (!pool || !query) return [];

  try {
    // ── 向量路径（OPENAI_API_KEY 存在时尝试）──────────────────
    if (process.env.OPENAI_API_KEY) {
      try {
        // 1. 生成 query embedding
        const queryEmbedding = await generateEmbedding(query.substring(0, 2000));
        const embStr = '[' + queryEmbedding.join(',') + ']';

        // 2. pgvector cosine 检索（只取有 embedding 的记录，TOP 20 候选）
        const vectorResult = await pool.query(`
          SELECT id, content, summary, l1_content, importance, memory_type, created_at,
                 1 - (embedding <=> $1::vector) AS vector_score
          FROM memory_stream
          WHERE embedding IS NOT NULL
            AND (source_type IS NULL OR source_type != 'self_model')
            AND (expires_at IS NULL OR expires_at > NOW())
          ORDER BY embedding <=> $1::vector
          LIMIT 20
        `, [embStr]);

        if (vectorResult.rows.length > 0) {
          // 3. L1 决策层：有 l1_content 用结构化摘要，否则降级到 content 前200字
          const results = [];
          let usedTokens = 0;
          for (const row of vectorResult.rows) {
            // 向量相似度低于 0.3 的忽略（避免完全不相关）
            if ((row.vector_score || 0) < 0.3) continue;
            const description = row.l1_content || (row.content || '').slice(0, 200);
            const lineTokens = estimateTokens(description);
            if (usedTokens + lineTokens > tokenBudget) break;
            results.push({
              id: row.id,
              source: 'episodic',
              title: `[片段记忆] ${(row.content || '').slice(0, 50)}`,
              description,
              text: row.content || '',
              relevance: 0.4 + (row.vector_score || 0) * 0.6,
              created_at: row.created_at,
              importance: row.importance,
            });
            usedTokens += lineTokens;
          }
          if (results.length > 0) return results;
          // 向量结果为空（所有分数 < 0.3）→ 继续降级到 Jaccard
        }
      } catch (_embErr) {
        // embedding 生成失败（网络/quota）→ 降级到 Jaccard
        console.warn('[memory-retriever] Episodic vector search failed, falling back to Jaccard:', _embErr.message);
      }
    }

    // ── Jaccard 降级路径（无 API key 或向量路径失败/无数据）──
    const result = await pool.query(`
      SELECT id, content, summary, l1_content, importance, memory_type, created_at
      FROM memory_stream
      WHERE (source_type IS NULL OR source_type != 'self_model')
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC
      LIMIT 30
    `);

    const rows = result.rows;
    if (rows.length === 0) return [];

    const queryTokens = new Set(query.toLowerCase().replace(/[^\w\s\u4e00-\u9fa5]/g, ' ').split(/\s+/).filter(t => t.length > 1));

    // L0 过滤：有 summary 就用 summary，否则用 content 前 100 字符
    const relevant = [];
    for (const row of rows) {
      const l0Text = row.summary || generateL0Summary(row.content);
      const l0Tokens = new Set(l0Text.toLowerCase().replace(/[^\w\s\u4e00-\u9fa5]/g, ' ').split(/\s+/).filter(t => t.length > 1));

      if (queryTokens.size === 0 || l0Tokens.size === 0) {
        relevant.push({ ...row, l0Score: 0.1 });
        continue;
      }

      let intersection = 0;
      for (const t of queryTokens) {
        if (l0Tokens.has(t)) intersection++;
      }
      const union = new Set([...queryTokens, ...l0Tokens]).size;
      const jaccard = union > 0 ? intersection / union : 0;

      if (jaccard >= 0.05 || relevant.length < 3) {
        relevant.push({ ...row, l0Score: jaccard });
      }
    }

    relevant.sort((a, b) => b.l0Score - a.l0Score);
    const candidates = relevant.slice(0, 10);

    // L1 决策层：有 l1_content 用结构化摘要，否则降级到 content 前200字
    const results = [];
    let usedTokens = 0;
    for (const row of candidates) {
      const description = row.l1_content || (row.content || '').slice(0, 200);
      const lineTokens = estimateTokens(description);
      if (usedTokens + lineTokens > tokenBudget) break;
      results.push({
        id: row.id,
        source: 'episodic',
        title: `[片段记忆] ${(row.content || '').slice(0, 50)}`,
        description,
        text: row.content || '',
        relevance: 0.5 + row.l0Score,
        created_at: row.created_at,
        importance: row.importance,
      });
      usedTokens += lineTokens;
    }

    return results;
  } catch (err) {
    console.warn('[memory-retriever] Episodic memory search failed (graceful fallback):', err.message);
    return [];
  }
}

/**
 * 事件记忆检索：时间窗口 + type 过滤（不做向量搜索）
 * @param {Object} pool - pg pool
 * @param {string} _query - 搜索文本（暂未使用，预留）
 * @param {string} mode - 模式
 * @returns {Promise<Array>} 候选列表
 */
async function loadRecentEvents(pool, _query, mode) {
  const hours = (mode === 'debug' || mode === 'chat') ? 72 : 24;

  try {
    const result = await pool.query(`
      SELECT id, event_type, source, payload, created_at
      FROM cecelia_events
      WHERE created_at > NOW() - INTERVAL '${hours} hours'
        AND event_type = ANY($1)
      ORDER BY created_at DESC
      LIMIT 10
    `, [RELEVANT_EVENT_TYPES]);

    return result.rows.map(r => {
      const payloadStr = typeof r.payload === 'string' ? r.payload : JSON.stringify(r.payload || {});
      return {
        id: r.id,
        source: 'event',
        title: `[${r.event_type}] ${r.source || ''}`,
        description: payloadStr.slice(0, 200),
        text: `${r.event_type} ${r.source || ''} ${payloadStr.slice(0, 200)}`,
        relevance: 0.5,
        created_at: r.created_at,
      };
    });
  } catch (err) {
    console.warn('[memory-retriever] Events search failed (graceful fallback):', err.message);
    return [];
  }
}

/**
 * 对话历史检索：从 cecelia_events 查最近的 orchestrator_chat 事件
 * @param {Object} pool - pg pool
 * @param {number} [limit=15] - 最多返回条数
 * @returns {Promise<Array>} 候选列表（source='conversation'）
 */
async function loadConversationHistory(pool, limit = 15) {
  try {
    const result = await pool.query(`
      SELECT id, payload, created_at
      FROM cecelia_events
      WHERE event_type = 'orchestrator_chat'
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);

    return result.rows.map(r => {
      const payload = typeof r.payload === 'string' ? JSON.parse(r.payload) : (r.payload || {});
      const userMsg = (payload.user_message || '').slice(0, 150);
      const replyMsg = (payload.reply || '').slice(0, 150);
      const text = `Alex: ${userMsg}\nCecelia: ${replyMsg}`;
      return {
        id: r.id,
        source: 'conversation',
        title: `[对话] ${userMsg.slice(0, 60)}`,
        description: replyMsg.slice(0, 200),
        text,
        relevance: 0.6,
        created_at: r.created_at,
      };
    });
  } catch (err) {
    console.warn('[memory-retriever] Conversation history load failed (graceful fallback):', err.message);
    return [];
  }
}

/**
 * 画像配置加载：主人 Facts（第0层）+ 当前 OKR 焦点（不参与评分排序）
 * @param {Object} pool - pg pool
 * @param {string} mode - 模式
 * @returns {Promise<string>} 格式化的 profile 片段
 */
async function loadActiveProfile(pool, mode) {
  // chat 模式也注入 OKR 焦点（让 Cecelia 知道自己在帮谁干活）
  // mode 参数保留用于未来区分注入深度
  void mode;

  const snippets = [];

  // 第0层：主人 Facts（user_profile_facts，精确查询，不走语义，约200 tokens）
  // 修复：原来查询不存在的 user_profiles 表，永远返回 null
  try {
    const factsResult = await pool.query(`
      SELECT content FROM user_profile_facts
      WHERE user_id = 'owner'
      ORDER BY created_at DESC
      LIMIT 10
    `);
    if (factsResult.rows.length > 0) {
      const factsText = factsResult.rows.map(r => `- ${r.content}`).join('\n');
      snippets.push(`## 关于主人（Alex）\n${factsText}\n`);
    }
  } catch (err) {
    console.warn('[memory-retriever] Owner facts load failed (graceful fallback):', err.message);
  }

  // OKR 焦点
  try {
    const goals = await pool.query(`
      SELECT title, status, progress FROM goals
      WHERE status IN ('in_progress', 'pending')
      ORDER BY priority ASC, progress DESC
      LIMIT 3
    `);

    if (goals.rows.length > 0) {
      let snippet = '## 当前 OKR 焦点\n';
      for (const g of goals.rows) {
        snippet += `- ${g.title} (${g.status}, ${g.progress || 0}%)\n`;
      }
      snippets.push(snippet);
    }
  } catch (err) {
    console.warn('[memory-retriever] Profile load failed (graceful fallback):', err.message);
  }

  return snippets.join('\n');
}

// ============================================================
// 主入口
// ============================================================

/**
 * 统一记忆检索入口
 *
 * @param {Object} options
 * @param {string} options.query - 搜索查询文本
 * @param {string} [options.mode='execute'] - 模式：'plan' | 'execute' | 'debug' | 'chat'
 * @param {number} [options.tokenBudget=800] - token 上限
 * @param {Object} options.pool - pg pool
 * @returns {Promise<{block: string, meta: Object}>} 格式化的 context block + 元数据
 */
export async function buildMemoryContext({ query, mode = 'execute', tokenBudget = DEFAULT_TOKEN_BUDGET, pool: dbPool }) {
  if (!query || !dbPool) {
    return { block: '', meta: { candidates: 0, injected: 0, tokenUsed: 0 } };
  }

  // 0. 记忆路由：根据意图决定激活哪类记忆（chat 模式启用）
  const { strategy } = mode === 'chat'
    ? routeMemory(query, mode)
    : { strategy: { semantic: true, episodic: false, events: true, episodicBudget: 0, semanticBudget: tokenBudget * 0.7, eventsBudget: tokenBudget * 0.3 } };

  // 1. 并行检索多路数据（根据路由策略）
  const fetches = [
    strategy.semantic !== false ? searchSemanticMemory(dbPool, query, mode) : Promise.resolve([]),
    strategy.events !== false ? loadRecentEvents(dbPool, query, mode) : Promise.resolve([]),
    loadActiveProfile(dbPool, mode),
  ];
  if (mode === 'chat') {
    fetches.push(loadConversationHistory(dbPool));
    // 片段记忆（episodic）：仅 chat 模式按路由策略加载
    if (strategy.episodic) {
      fetches.push(searchEpisodicMemory(dbPool, query, strategy.episodicBudget || 300));
    } else {
      fetches.push(Promise.resolve([]));
    }
  }
  const [semanticResults, eventResults, profileSnippet, conversationResults, episodicResults] =
    await Promise.all(fetches);

  // 2. 统一评分（语义 + 事件 + 对话 + 片段记忆混合，profile 不参与）
  const candidates = [
    ...semanticResults,
    ...eventResults,
    ...(conversationResults || []),
    ...(episodicResults || []),
  ];

  // 2a. 意图分类 → 动态权重倍数
  const intentType = classifyQueryIntent(query);
  const dynamicMultipliers = INTENT_WEIGHT_MULTIPLIER[intentType] || {};

  const scored = candidates.map(c => {
    const source = c.source || 'task';
    const halfLife = HALF_LIFE[source] || 30;
    const modeW = (MODE_WEIGHT[source] && MODE_WEIGHT[source][mode]) || 1.0;
    const dynW = dynamicMultipliers[source] || 1.0;
    return {
      ...c,
      finalScore: c.relevance * timeDecay(c.created_at, halfLife) * modeW * dynW,
    };
  });

  // 3. MMR 重排（平衡相关性与多样性，替代简单去重）
  const deduped = mmrRerank(scored, Math.min(scored.length, 20));

  // 3a. Quota-aware 选择（保证 source 最小配额，限制 conversation 上限）
  const quotaSelected = quotaAwareSelect(deduped, scored);

  // 4. Token 预算截断（按 finalScore 从高到低填充，配额内的优先）
  // 先对结果按 finalScore 排序（quota 补充的可能是低分的）
  quotaSelected.sort((a, b) => b.finalScore - a.finalScore);

  let block = '';
  let tokenUsed = 0;

  // Profile 优先放入
  if (profileSnippet) {
    const profileTokens = estimateTokens(profileSnippet);
    block += profileSnippet + '\n';
    tokenUsed += profileTokens;
  }

  // 记忆条目按 score 从高到低填入
  block += '\n## 相关历史上下文\n';
  tokenUsed += 10;

  let injectedCount = 0;
  for (const item of quotaSelected) {
    const line = formatItem(item);
    const lineTokens = estimateTokens(line);
    if (tokenUsed + lineTokens > tokenBudget) break;
    block += line + '\n';
    tokenUsed += lineTokens;
    injectedCount++;
  }

  // 如果没有注入任何记忆，返回空 block
  if (injectedCount === 0 && !profileSnippet) {
    return { block: '', meta: { candidates: candidates.length, injected: 0, tokenUsed: 0, tokenBudget, intentType } };
  }

  return {
    block,
    meta: {
      candidates: candidates.length,
      injected: injectedCount,
      tokenUsed,
      tokenBudget,
      intentType,
      sources: quotaSelected.slice(0, injectedCount).map(i => i.source),
    },
  };
}

// ============================================================
// Exports（测试用）
// ============================================================

export {
  searchSemanticMemory as _searchSemanticMemory,
  loadRecentEvents as _loadRecentEvents,
  loadConversationHistory as _loadConversationHistory,
  loadActiveProfile as _loadActiveProfile,
  formatItem as _formatItem,
  tokenize as _tokenize,
  RELEVANT_EVENT_TYPES,
  DEFAULT_TOKEN_BUDGET,
};
