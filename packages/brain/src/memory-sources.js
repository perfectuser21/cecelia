import { generateL0Summary } from './memory-utils.js';
import { generateEmbedding } from './openai-client.js';
import { _classifyError, _disabledResult, RELEVANT_EVENT_TYPES, estimateTokens } from './memory-selection.js';

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
  if (!pool || !query) return _disabledResult();

  const meta = { requestedLimit: 20, fetchedCount: 0, fetchStatus: 'ok', candidateCount: 0 };

  try {
    // ── 向量路径（OPENAI_API_KEY 存在时尝试）──────────────────
    if (process.env.OPENAI_API_KEY) {
      try {
        const queryEmbedding = await generateEmbedding(query.substring(0, 2000));
        const embStr = '[' + queryEmbedding.join(',') + ']';

        const vectorResult = await pool.query(`
          SELECT id, content, summary, l1_content, importance, memory_type, created_at,
                 salience_score,
                 1 - (embedding <=> $1::vector) AS vector_score
          FROM memory_stream
          WHERE embedding IS NOT NULL
            AND (source_type IS NULL OR source_type != 'self_model')
            AND (expires_at IS NULL OR expires_at > NOW())
          ORDER BY embedding <=> $1::vector
          LIMIT 20
        `, [embStr]);

        if (vectorResult.rows.length > 0) {
          const results = [];
          let usedTokens = 0;
          for (const row of vectorResult.rows) {
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
              salience_score: row.salience_score || 0,
            });
            usedTokens += lineTokens;
          }
          if (results.length > 0) {
            meta.fetchedCount = vectorResult.rows.length;
            meta.fetchStatus = 'ok';
            meta.candidateCount = results.length;
            return { entries: results, meta };
          }
          // 向量结果为空（所有分数 < 0.3）→ 继续降级到 Jaccard
        }
      } catch (_embErr) {
        console.warn('[memory-retriever] Episodic vector search failed, falling back to Jaccard:', _embErr.message);
        // 降级继续，fetchStatus 后续由 Jaccard 路径决定
      }
    }

    // ── Jaccard 降级路径（无 API key 或向量路径失败/无数据）──
    meta.fetchStatus = 'fallback_jaccard';
    const result = await pool.query(`
      SELECT id, content, summary, l1_content, importance, memory_type, created_at, salience_score
      FROM memory_stream
      WHERE (source_type IS NULL OR source_type != 'self_model')
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC
      LIMIT 30
    `);

    const rows = result.rows;
    meta.fetchedCount = rows.length;
    if (rows.length === 0) {
      meta.fetchStatus = 'no_results';
      return { entries: [], meta };
    }

    const queryTokens = new Set(query.toLowerCase().replace(/[^\w\s\u4e00-\u9fa5]/g, ' ').split(/\s+/).filter(t => t.length > 1));

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
    const topCandidates = relevant.slice(0, 10);

    const results = [];
    let usedTokens = 0;
    for (const row of topCandidates) {
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
        salience_score: row.salience_score || 0,
      });
      usedTokens += lineTokens;
    }

    meta.candidateCount = results.length;
    return { entries: results, meta };
  } catch (err) {
    console.warn('[memory-retriever] Episodic memory search failed (graceful fallback):', err.message);
    meta.fetchStatus = _classifyError(err);
    return { entries: [], meta };
  }
}

/**
 * 事件记忆检索：时间窗口 + type 过滤（不做向量搜索）
 * @param {Object} pool - pg pool
 * @param {string} _query - 搜索文本（暂未使用，预留）
 * @param {string} mode - 模式
 * @returns {Promise<{entries: Array, meta: Object}>}
 */
async function loadRecentEvents(pool, _query, mode) {
  const hours = (mode === 'debug' || mode === 'chat') ? 72 : 24;
  const meta = { requestedLimit: 10, fetchedCount: 0, fetchStatus: 'ok', candidateCount: 0 };

  try {
    const result = await pool.query(`
      SELECT id, event_type, source, payload, created_at
      FROM cecelia_events
      WHERE created_at > NOW() - INTERVAL '${hours} hours'
        AND event_type = ANY($1)
      ORDER BY created_at DESC
      LIMIT 10
    `, [RELEVANT_EVENT_TYPES]);

    const entries = result.rows.map(r => {
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
    meta.fetchedCount = entries.length;
    meta.fetchStatus = entries.length === 0 ? 'no_results' : 'ok';
    meta.candidateCount = entries.length;
    return { entries, meta };
  } catch (err) {
    console.warn('[memory-retriever] Events search failed (graceful fallback):', err.message);
    meta.fetchStatus = _classifyError(err);
    return { entries: [], meta };
  }
}

/**
 * 对话历史检索：主路径从 memory_stream 查 conversation_turn（带 embedding 语义），
 * 空时 fallback 到 cecelia_events（向后兼容）
 * @param {Object} pool - pg pool
 * @param {number} [limit=15] - 最多返回条数
 * @returns {Promise<{entries: Array, meta: Object}>}
 */
async function loadConversationHistory(pool, limit = 15) {
  const meta = { requestedLimit: limit, fetchedCount: 0, fetchStatus: 'ok', candidateCount: 0 };

  // 主路径：从 memory_stream 查 source_type='conversation_turn'（带 embedding 可语义检索）
  try {
    const msResult = await pool.query(`
      SELECT id, content, salience_score, created_at
      FROM memory_stream
      WHERE source_type = 'conversation_turn' AND status = 'active'
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);

    if (msResult.rows.length > 0) {
      const entries = msResult.rows.map(r => ({
        id: r.id,
        source: 'conversation',
        title: `[对话] ${(r.content || '').slice(0, 60)}`,
        description: (r.content || '').slice(0, 200),
        text: r.content || '',
        relevance: r.salience_score || 0.5,
        created_at: r.created_at,
      }));
      meta.fetchedCount = entries.length;
      meta.fetchStatus = 'ok';
      meta.candidateCount = entries.length;
      return { entries, meta };
    }
  } catch (err) {
    console.warn('[memory-retriever] memory_stream conversation load failed, falling back:', err.message);
  }

  // Fallback：cecelia_events（向后兼容，无 embedding）
  try {
    const result = await pool.query(`
      SELECT id, payload, created_at
      FROM cecelia_events
      WHERE event_type = 'orchestrator_chat'
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);

    const entries = result.rows.map(r => {
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
    meta.fetchedCount = entries.length;
    meta.fetchStatus = entries.length === 0 ? 'no_results' : 'ok';
    meta.candidateCount = entries.length;
    return { entries, meta };
  } catch (err) {
    console.warn('[memory-retriever] Conversation history load failed (graceful fallback):', err.message);
    meta.fetchStatus = _classifyError(err);
    return { entries: [], meta };
  }
}

/**
 * 画像配置加载：主人 Facts（第0层）+ 当前 OKR 焦点（不参与评分排序）
 * @param {Object} pool - pg pool
 * @param {string} mode - 模式
 * @returns {Promise<{snippet: string, meta: Object}>}
 */
async function loadActiveProfile(pool, mode) {
  void mode;

  const snippets = [];
  const meta = { fetchStatus: 'ok' };

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
    if (meta.fetchStatus === 'ok') meta.fetchStatus = _classifyError(err);
  }

  try {
    // 迁移：goals → objectives（area_okr type）
    const goals = await pool.query(`
      SELECT title, status, 0 AS progress FROM objectives
      WHERE status IN ('in_progress', 'pending', 'active')
      ORDER BY priority ASC, updated_at DESC
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
    if (meta.fetchStatus === 'ok') meta.fetchStatus = _classifyError(err);
  }

  const snippet = snippets.join('\n');
  if (!snippet && meta.fetchStatus === 'ok') meta.fetchStatus = 'no_results';
  return { snippet, meta };
}

export { loadRecentEvents, loadConversationHistory, loadActiveProfile };
