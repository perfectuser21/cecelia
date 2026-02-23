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
import { loadUserProfile, formatProfileSnippet } from './user-profile.js';

// ============================================================
// 常量配置
// ============================================================

/** 各数据源的时间衰减半衰期（天） */
export const HALF_LIFE = {
  task: 30,
  learning: 90,
  event: 1,
  okr: Infinity,
  capability: Infinity,
};

/** 各模式下各数据源的权重 */
export const MODE_WEIGHT = {
  task:       { plan: 1.0, execute: 1.2, debug: 1.0, chat: 0.8 },
  learning:   { plan: 0.8, execute: 1.0, debug: 1.5, chat: 0.6 },
  event:      { plan: 0.5, execute: 0.8, debug: 1.5, chat: 0.3 },
  okr:        { plan: 1.5, execute: 0.5, debug: 0.3, chat: 1.0 },
  capability: { plan: 1.0, execute: 0.8, debug: 0.5, chat: 0.5 },
};

/** 默认 token 预算 */
const DEFAULT_TOKEN_BUDGET = 800;

/** 事件记忆中感兴趣的 event types */
const RELEVANT_EVENT_TYPES = [
  'task_failed',
  'task_completed',
  'alert',
  'layer2_health',
  'escalation',
  'llm_api_error',
  'llm_bad_output',
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

/**
 * 事件记忆检索：时间窗口 + type 过滤（不做向量搜索）
 * @param {Object} pool - pg pool
 * @param {string} _query - 搜索文本（暂未使用，预留）
 * @param {string} mode - 模式
 * @returns {Promise<Array>} 候选列表
 */
async function loadRecentEvents(pool, _query, mode) {
  const hours = mode === 'debug' ? 72 : 24;

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
 * 画像配置加载：当前 OKR 焦点（不参与评分排序）
 * @param {Object} pool - pg pool
 * @param {string} mode - 模式
 * @returns {Promise<string>} 格式化的 profile 片段
 */
async function loadActiveProfile(pool, mode) {
  // chat 模式也注入 OKR 焦点（让 Cecelia 知道自己在帮谁干活）
  // mode 参数保留用于未来区分注入深度
  void mode;

  const snippets = [];

  // 主人画像（user_profiles）
  try {
    const profile = await loadUserProfile(pool, 'owner');
    const profileSnippet = formatProfileSnippet(profile);
    if (profileSnippet) snippets.push(profileSnippet);
  } catch (err) {
    console.warn('[memory-retriever] User profile load failed (graceful fallback):', err.message);
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

  // 1. 并行检索三路数据
  const [semanticResults, eventResults, profileSnippet] = await Promise.all([
    searchSemanticMemory(dbPool, query, mode),
    loadRecentEvents(dbPool, query, mode),
    loadActiveProfile(dbPool, mode),
  ]);

  // 2. 统一评分（语义 + 事件混合，profile 不参与）
  const candidates = [...semanticResults, ...eventResults];
  const scored = candidates.map(c => {
    const source = c.source || 'task';
    const halfLife = HALF_LIFE[source] || 30;
    const weight = (MODE_WEIGHT[source] && MODE_WEIGHT[source][mode]) || 1.0;
    return {
      ...c,
      finalScore: c.relevance * timeDecay(c.created_at, halfLife) * weight,
    };
  });

  // 3. MMR 重排（平衡相关性与多样性，替代简单去重）
  const deduped = mmrRerank(scored, Math.min(scored.length, 20));

  // 4. Token 预算截断
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
  for (const item of deduped) {
    const line = formatItem(item);
    const lineTokens = estimateTokens(line);
    if (tokenUsed + lineTokens > tokenBudget) break;
    block += line + '\n';
    tokenUsed += lineTokens;
    injectedCount++;
  }

  // 如果没有注入任何记忆，返回空 block
  if (injectedCount === 0 && !profileSnippet) {
    return { block: '', meta: { candidates: candidates.length, injected: 0, tokenUsed: 0 } };
  }

  return {
    block,
    meta: {
      candidates: candidates.length,
      injected: injectedCount,
      tokenUsed,
      tokenBudget,
      sources: deduped.slice(0, injectedCount).map(i => i.source),
    },
  };
}

// ============================================================
// Exports（测试用）
// ============================================================

export {
  searchSemanticMemory as _searchSemanticMemory,
  loadRecentEvents as _loadRecentEvents,
  loadActiveProfile as _loadActiveProfile,
  formatItem as _formatItem,
  tokenize as _tokenize,
  RELEVANT_EVENT_TYPES,
  DEFAULT_TOKEN_BUDGET,
};
