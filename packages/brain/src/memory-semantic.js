import SimilarityService from './similarity.js';
import { searchRelevantLearnings } from './learning.js';
import { _classifyError } from './memory-selection.js';

// ============================================================
// 数据源适配器
// ============================================================

/**
 * 语义记忆检索：tasks + learnings（向量/Jaccard 混合搜索）
 * @param {Object} pool - pg pool
 * @param {string} query - 搜索文本
 * @param {string} mode - 模式
 * @returns {Promise<{entries: Array, meta: Object}>}
 */
async function searchSemanticMemory(pool, query, _mode) {
  const candidates = [];
  const meta = { requestedLimit: 30, fetchedCount: 0, fetchStatus: 'ok', candidateCount: 0 };

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
        source: ['capability', 'project', 'kr', 'okr'].includes(m.level) ? m.level : 'task',
        title: m.title || '',
        description: m.description || '',
        text: `${m.title || ''} ${m.description || ''}`,
        relevance: m.score || 0,
        created_at: m.created_at || null,
        status: m.status,
      });
    }
    meta.fetchedCount += (results.matches || []).length;
  } catch (err) {
    console.warn('[memory-retriever] Semantic search failed (graceful fallback):', err.message);
    if (meta.fetchStatus === 'ok') meta.fetchStatus = _classifyError(err);
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
      const fullContent = typeof l.content === 'string' ? l.content : JSON.stringify(l.content || '');
      candidates.push({
        id: l.id,
        source: 'learning',
        title: l.title || '',
        description: fullContent.slice(0, 300),
        full_content: fullContent,
        text: `${l.title || ''} ${l.content || ''}`,
        relevance: (l.relevance_score || 0) / 30,
        created_at: l.created_at || null,
      });
    }
    meta.fetchedCount += learnings.length;
  } catch (err) {
    console.warn('[memory-retriever] Learnings search failed (graceful fallback):', err.message);
    if (meta.fetchStatus === 'ok') meta.fetchStatus = _classifyError(err);
  }

  // 3. 搜索 goals（KR/OKR）— Jaccard 关键词匹配
  try {
    const queryTokens = new Set(
      query.toLowerCase().replace(/[^\w\s\u4e00-\u9fa5]/g, ' ').split(/\s+/).filter(t => t.length > 1)
    );
    if (queryTokens.size > 0) {
      // 迁移：goals → objectives UNION key_results
      const goalResults = await pool.query(
        `SELECT id, title, description, 'area_okr' AS type, status, created_at
         FROM objectives
         WHERE status NOT IN ('completed', 'cancelled')
         UNION ALL
         SELECT id, title, description, 'area_kr' AS type, status, created_at
         FROM key_results
         WHERE status NOT IN ('completed', 'cancelled')
         ORDER BY created_at DESC
         LIMIT 30`
      );
      for (const g of goalResults.rows) {
        const text = `${g.title || ''} ${g.description || ''}`.toLowerCase()
          .replace(/[^\w\s\u4e00-\u9fa5]/g, ' ');
        const textTokens = new Set(text.split(/\s+/).filter(t => t.length > 1));
        const intersection = [...queryTokens].filter(t => textTokens.has(t)).length;
        if (intersection > 0) {
          const union = new Set([...queryTokens, ...textTokens]).size;
          candidates.push({
            id: g.id,
            source: (g.type === 'global_kr' || g.type === 'area_kr') ? 'kr' : 'okr',
            title: g.title || '',
            description: (g.description || '').slice(0, 300),
            full_content: g.description || '',
            text: `${g.title || ''} ${g.description || ''}`,
            relevance: intersection / union,
            created_at: g.created_at || null,
            status: g.status,
          });
        }
      }
      meta.fetchedCount += goalResults.rows.length;
    }
  } catch (err) {
    console.warn('[memory-retriever] Goals search failed (graceful fallback):', err.message);
    if (meta.fetchStatus === 'ok') meta.fetchStatus = _classifyError(err);
  }

  // 4. 搜索 projects（Project/Initiative）— Jaccard 关键词匹配
  try {
    const queryTokens = new Set(
      query.toLowerCase().replace(/[^\w\s\u4e00-\u9fa5]/g, ' ').split(/\s+/).filter(t => t.length > 1)
    );
    if (queryTokens.size > 0) {
      const projectResults = await pool.query(
        `SELECT id, name, description, 'project' AS type, created_at
         FROM projects ORDER BY created_at DESC LIMIT 30`
      );
      for (const p of projectResults.rows) {
        const text = `${p.name || ''} ${p.description || ''}`.toLowerCase()
          .replace(/[^\w\s\u4e00-\u9fa5]/g, ' ');
        const textTokens = new Set(text.split(/\s+/).filter(t => t.length > 1));
        const intersection = [...queryTokens].filter(t => textTokens.has(t)).length;
        if (intersection > 0) {
          const union = new Set([...queryTokens, ...textTokens]).size;
          candidates.push({
            id: p.id,
            source: 'project',
            title: p.name || '',
            description: (p.description || '').slice(0, 300),
            full_content: p.description || '',
            text: `${p.name || ''} ${p.description || ''}`,
            relevance: intersection / union,
            created_at: p.created_at || null,
            status: null,
          });
        }
      }
      meta.fetchedCount += projectResults.rows.length;
    }
  } catch (err) {
    console.warn('[memory-retriever] Projects search failed (graceful fallback):', err.message);
    if (meta.fetchStatus === 'ok') meta.fetchStatus = _classifyError(err);
  }

  if (meta.fetchedCount === 0 && meta.fetchStatus === 'ok') meta.fetchStatus = 'no_results';
  meta.candidateCount = candidates.length;
  return { entries: candidates, meta };
}

// ============================================================
// 深度感知 enrichment：为 goals/projects 批量补充 task_count / parent_kr_title
// ============================================================

/**
 * 批量为 goals/projects 候选补充 task_count 和 parent_kr_title（depth>=1 时调用）
 * 直接 mutate 传入的 candidates 数组
 * @param {Object} pool - pg pool
 * @param {Array} candidates - semanticResults
 */
async function _enrichStructuredCandidates(pool, candidates) {
  const goalIds = candidates.filter(c => c.source === 'kr' || c.source === 'okr').map(c => c.id);
  const projectIds = candidates.filter(c => c.source === 'project').map(c => c.id);

  try {
    // task_count for KR via projects.kr_id
    if (goalIds.length > 0) {
      const res = await pool.query(
        `SELECT op.kr_id as goal_id, COUNT(t.id)::int as task_count
         FROM tasks t
         JOIN projects op ON op.id = t.project_id
         WHERE op.kr_id = ANY($1) AND t.task_type <> 'project' AND t.status NOT IN ('completed','cancelled','quarantined')
         GROUP BY op.kr_id`,
        [goalIds]
      );
      const countMap = Object.fromEntries(res.rows.map(r => [r.goal_id, r.task_count]));
      for (const c of candidates) {
        if ((c.source === 'kr' || c.source === 'okr') && countMap[c.id] !== undefined) {
          c.task_count = countMap[c.id];
        }
      }
    }

    // task_count for projects/initiatives
    if (projectIds.length > 0) {
      const res = await pool.query(
        `SELECT project_id, COUNT(id)::int as task_count
         FROM tasks
         WHERE project_id = ANY($1) AND task_type <> 'project' AND status NOT IN ('completed','cancelled','quarantined')
         GROUP BY project_id`,
        [projectIds]
      );
      const countMap = Object.fromEntries(res.rows.map(r => [r.project_id, r.task_count]));
      for (const c of candidates) {
        if (c.source === 'project' && countMap[c.id] !== undefined) {
          c.task_count = countMap[c.id];
        }
      }
    }

    // 项目直接通过 kr_id 获取上级目标。
    if (projectIds.length > 0) {
      const res = await pool.query(
        `SELECT p.id AS project_id, kr.title AS kr_title FROM projects p
         JOIN key_results kr ON kr.id = p.kr_id WHERE p.id = ANY($1)`, [projectIds]
      );
      const krMap = Object.fromEntries(res.rows.map(r => [r.project_id, r.kr_title]));
      for (const c of candidates) {
        if (c.source === 'project' && krMap[c.id]) c.parent_kr_title = krMap[c.id];
      }
    }
  } catch (err) {
    console.warn('[memory-retriever] Enrichment failed (graceful fallback):', err.message);
  }
}

export { searchSemanticMemory, _enrichStructuredCandidates };
