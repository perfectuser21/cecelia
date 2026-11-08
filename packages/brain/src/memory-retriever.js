/**
 * Memory Retriever - 统一记忆检索器
 *
 * 四层记忆模型：
 * - Layer 2 蒸馏文档 (Distilled): SOUL + SELF_MODEL 每次必注入（预算外），chat 模式追加 USER_PROFILE + WORLD_STATE
 * - 语义记忆 (Semantic): tasks + learnings + capabilities 的向量搜索
 * - 事件记忆 (Episodic): cecelia_events 时间窗口 + type 过滤
 * - 画像配置 (Profile): OKR 目标 + 能力摘要（不衰减）
 *
 * 统一入口：buildMemoryContext({query, mode, tokenBudget, pool})
 * 替代 thalamus 原有的双注入逻辑（learningBlock + memoryBlock）
 */

import { routeMemory } from './memory-router.js';
import { getDoc } from './distilled-docs.js';
import { searchSemanticMemory, _enrichStructuredCandidates } from './memory-semantic.js';
import { searchEpisodicMemory, loadRecentEvents, loadConversationHistory, loadActiveProfile } from './memory-sources.js';
import { HALF_LIFE, MODE_WEIGHT, SALIENCE_WEIGHT, INTENT_WEIGHT_MULTIPLIER, DEFAULT_TOKEN_BUDGET,
  _disabledResult, computeTopicDepth, classifyQueryIntent, timeDecay, mmrRerank, quotaAwareSelect,
  estimateTokens, isWorldStateQuery, formatItem } from './memory-selection.js';

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

  // 0b. Layer 2 蒸馏文档检索（与其他检索并行）
  // WORLD_STATE 仅在 chat 模式且查询与 OKR/任务/项目相关时注入，避免闲聊浪费 token
  const distilledTypes = mode === 'chat'
    ? (isWorldStateQuery(query)
        ? ['SOUL', 'SELF_MODEL', 'USER_PROFILE', 'WORLD_STATE']
        : ['SOUL', 'SELF_MODEL', 'USER_PROFILE'])
    : ['SOUL', 'SELF_MODEL'];

  // 1. 并行检索多路数据（统一 5 路 + Layer 2 蒸馏文档）
  const [semanticResult, eventResult, profileResult, convResult, episodicResult, ...distilledDocs] =
    await Promise.all([
      strategy.semantic !== false ? searchSemanticMemory(dbPool, query, mode) : _disabledResult(),
      strategy.events  !== false ? loadRecentEvents(dbPool, query, mode)      : _disabledResult(),
      loadActiveProfile(dbPool, mode),
      mode === 'chat' ? loadConversationHistory(dbPool) : _disabledResult(),
      mode === 'chat' && strategy.episodic
        ? searchEpisodicMemory(dbPool, query, strategy.episodicBudget || 300)
        : _disabledResult(),
      ...distilledTypes.map(t => getDoc(t, dbPool)),
    ]);

  const semanticResults     = semanticResult.entries;
  const semanticMeta        = semanticResult.meta;
  const eventResults        = eventResult.entries;
  const eventsMeta          = eventResult.meta;
  const profileSnippet      = profileResult.snippet || '';
  const profileMeta         = profileResult.meta;
  const conversationResults = convResult.entries;
  const convMeta            = convResult.meta;
  const episodicResults     = episodicResult.entries;
  const episodicMeta        = episodicResult.meta;

  // 1b. 对话深度检测（用于记忆分层返回）
  const depth = computeTopicDepth(query, conversationResults);

  // 1c. depth >= 1 时为 goals/projects 批量查询 task_count 和父级 KR
  if (depth >= 1 && semanticResults.length > 0) {
    await _enrichStructuredCandidates(dbPool, semanticResults);
  }

  // 2. 统一评分（语义 + 事件 + 对话 + 片段记忆混合，profile 不参与）
  const candidates = [
    ...semanticResults,
    ...eventResults,
    ...conversationResults,
    ...episodicResults,
  ];

  // 2a. 意图分类 → 动态权重倍数
  const intentType = classifyQueryIntent(query);
  const dynamicMultipliers = INTENT_WEIGHT_MULTIPLIER[intentType] || {};

  const scored = candidates.map(c => {
    const source = c.source || 'task';
    const halfLife = HALF_LIFE[source] || 30;
    const modeW = (MODE_WEIGHT[source] && MODE_WEIGHT[source][mode]) || 1.0;
    const dynW = dynamicMultipliers[source] || 1.0;
    // salience_score 加权：来自 IN filter（PR9）标记的高价值记忆获得加分
    // salience_score 为 null/undefined 时降级为 0（向后兼容）
    const salienceBoost = 1 + (c.salience_score || 0) * SALIENCE_WEIGHT;
    return {
      ...c,
      finalScore: c.relevance * timeDecay(c.created_at, halfLife) * modeW * dynW * salienceBoost,
    };
  });

  // 3. MMR 重排（平衡相关性与多样性）
  const deduped = mmrRerank(scored, Math.min(scored.length, 20));

  // 3a. Quota-aware 选择（保证 source 最小配额，限制 conversation 上限）
  const quotaSelected = quotaAwareSelect(deduped, scored);

  // 4. Token 预算截断，同时按 source 统计注入量
  quotaSelected.sort((a, b) => b.finalScore - a.finalScore);

  let block = '';
  let tokenUsed = 0;

  // 4a. Layer 2 蒸馏文档注入（预算外，优先保证身份锚点）
  // USER_PROFILE + WORLD_STATE 合计上限 1200 tokens，超出截断
  const DISTILLED_BUDGET_TOKENS = 1200;
  const DISTILLED_BUDGET_TYPES = new Set(['USER_PROFILE', 'WORLD_STATE']);
  const distilledMap = {};
  let distilledBudgetUsed = 0;
  for (let i = 0; i < distilledTypes.length; i++) {
    if (distilledDocs[i] && distilledDocs[i].content) {
      const docType = distilledTypes[i];
      let content = distilledDocs[i].content;
      if (DISTILLED_BUDGET_TYPES.has(docType)) {
        const contentTokens = estimateTokens(content);
        const remaining = DISTILLED_BUDGET_TOKENS - distilledBudgetUsed;
        if (remaining <= 0) continue;
        if (contentTokens > remaining) {
          const maxChars = Math.floor(remaining * 2.5);
          content = content.slice(0, maxChars);
        }
        distilledBudgetUsed += estimateTokens(content);
      }
      distilledMap[docType] = content;
      block += content + '\n\n';
    }
  }

  // block 总长度检查：超过 32000 字符（约 8000 tokens）时发出警告
  if (block.length > 32000) {
    console.warn('[memory] block size exceeded 32000 chars', { blockLength: block.length, mode, query: query.slice(0, 100) });
  }

  if (profileSnippet) {
    block += profileSnippet + '\n';
    tokenUsed += estimateTokens(profileSnippet);
  }

  block += '\n## 相关历史上下文\n';
  tokenUsed += 10;

  let injectedCount = 0;
  const sourceStats = {};

  for (const item of quotaSelected) {
    const line = formatItem(item, depth);
    const lineTokens = estimateTokens(line);
    if (tokenUsed + lineTokens > tokenBudget) break;
    block += line + '\n';
    tokenUsed += lineTokens;
    injectedCount++;

    // 按 source 统计注入量
    const src = item.source;
    if (!sourceStats[src]) sourceStats[src] = { selectedCount: 0, selectedTokens: 0 };
    sourceStats[src].selectedCount++;
    sourceStats[src].selectedTokens += lineTokens;
  }

  // 5. 构建 errors 列表（仅记录真正的失败，排除 ok / no_results / disabled）
  const errors = [];
  const fetchMetas = { semantic: semanticMeta, events: eventsMeta, conversation: convMeta, episodic: episodicMeta };
  for (const [name, fm] of Object.entries(fetchMetas)) {
    if (fm && fm.fetchStatus !== 'ok' && fm.fetchStatus !== 'no_results' && fm.fetchStatus !== 'disabled' && fm.fetchStatus !== 'fallback_jaccard') {
      errors.push(`${name}:${fm.fetchStatus}`);
    }
  }

  // 6. 结构化 log —— 每次对话的记忆检索仪表盘
  const logMeta = {
    tag: 'memory_selection',
    intentType,
    topicDepth: depth,
    tokenBudget,
    tokenUsed,
    candidateTotal: candidates.length,
    injectedTotal: injectedCount,
    embeddingMode: process.env.OPENAI_API_KEY ? 'openai' : 'jaccard',
    distilledDocs: distilledTypes.reduce((acc, t, i) => {
      acc[t] = distilledDocs[i] ? 'injected' : 'missing';
      return acc;
    }, {}),
    fetch: {
      semantic:     semanticMeta,
      events:       eventsMeta,
      conversation: convMeta,
      episodic:     episodicMeta,
      profile:      { fetchStatus: profileMeta.fetchStatus },
    },
    selected: sourceStats,
    errors,
  };
  console.log('[memory]', JSON.stringify(logMeta));

  // 如果没有注入任何记忆（包含蒸馏文档也算注入），返回空 block
  const hasSoulOrDistilled = Object.keys(distilledMap).length > 0;
  if (injectedCount === 0 && !profileSnippet && !hasSoulOrDistilled) {
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
      distilledDocs: logMeta.distilledDocs,
      sources: quotaSelected.slice(0, injectedCount).map(i => i.source),
    },
  };
}

export { HALF_LIFE, MODE_WEIGHT, SALIENCE_WEIGHT, CHAT_TOKEN_BUDGET, SOURCE_QUOTA,
  INTENT_WEIGHT_MULTIPLIER, computeTopicDepth, classifyQueryIntent, quotaAwareSelect, timeDecay,
  simpleDedup, mmrRerank, jaccardSimilarity, estimateTokens, isWorldStateQuery,
  formatItem as _formatItem, tokenize as _tokenize, RELEVANT_EVENT_TYPES, DEFAULT_TOKEN_BUDGET } from './memory-selection.js';
export { searchSemanticMemory as _searchSemanticMemory } from './memory-semantic.js';
export { searchEpisodicMemory, loadRecentEvents as _loadRecentEvents,
  loadConversationHistory as _loadConversationHistory, loadActiveProfile as _loadActiveProfile } from './memory-sources.js';
export { generateL0Summary } from './memory-utils.js';
