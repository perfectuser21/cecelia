/** 经验检索：向量/关键词有界候选、降级与相关度排序。公开入口仍由learning.js转出。 */
import pool from './db.js';
import { generateEmbedding } from './openai-client.js';

/**
 * Search relevant learnings based on semantic context
 * @param {Object} context - Search context
 * @param {string} context.task_type - Task type (dev/review/qa/audit/research/talk/data)
 * @param {string} context.failure_class - Failure class (NETWORK/BILLING_CAP/RATE_LIMIT/RESOURCE/etc)
 * @param {string} context.event_type - Event type (systemic_failure/rca_request/etc)
 * @param {number} limit - Maximum number of results
 * @returns {Promise<Array>} - Learning records sorted by relevance
 */
export async function searchRelevantLearnings(context = {}, limit = 10) {
  try {
    // Build query text from context
    const queryText = [context.task_type, context.failure_class, context.event_type, context.description]
      .filter(Boolean).join(' ');

    // Check if vector search is available
    let useVectorSearch = false;
    if (queryText && process.env.OPENAI_API_KEY) {
      try {
        const countResult = await pool.query(
          `SELECT COUNT(*) FROM learnings WHERE embedding IS NOT NULL`
        );
        useVectorSearch = parseInt(countResult.rows[0].count) > 0;
      } catch {
        // embedding column may not exist yet, fallback to keyword
      }
    }

    let results;
    if (useVectorSearch) {
      results = await vectorSearchLearnings(queryText, limit * 2, context);
    } else {
      results = await keywordSearchLearnings(context, limit);
    }

    // Sort by score and return top N
    results.sort((a, b) => b.relevance_score - a.relevance_score);
    return results.slice(0, limit);
  } catch (err) {
    console.error(`[learning] Failed to search relevant learnings: ${err.message}`);
    // Fallback to keyword search (preserves relevance_score); only use getRecentLearnings if that also fails
    try {
      const fallback = await keywordSearchLearnings(context, limit);
      fallback.sort((a, b) => b.relevance_score - a.relevance_score);
      return fallback;
    } catch {
      // Last resort: getRecentLearnings — add relevance_score: 0 so callers can rely on the property
      const recent = await getRecentLearnings(null, limit);
      return recent.map(l => ({ ...l, relevance_score: 0 }));
    }
  }
}

/**
 * Vector search for learnings using pgvector
 * @param {string} queryText - Query text
 * @param {number} limit - Maximum results
 * @param {Object} context - Search context for keyword boost
 * @returns {Promise<Array>} Scored learning records
 */
async function vectorSearchLearnings(queryText, limit, context = {}) {
  const queryEmbedding = await generateEmbedding(queryText);
  const embStr = `[${queryEmbedding.join(',')}]`;

  const result = await pool.query(`
    SELECT id, title, category, trigger_event, content, strategy_adjustments,
           applied, created_at, metadata,
           1 - (embedding <=> $1::vector) AS vector_score
    FROM learnings
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> $1::vector
    LIMIT $2
  `, [embStr, limit]);

  return result.rows.map(learning => {
    const vectorScore = learning.vector_score || 0;
    const boost = keywordBoost(learning, context);
    return {
      ...learning,
      relevance_score: (vectorScore * 30) + boost,  // Scale to match keyword scoring range (~30 max)
    };
  });
}

/**
 * Keyword-based search for learnings (fallback)
 * @param {Object} context - Search context
 * @param {number} limit - Maximum results
 * @returns {Promise<Array>} Scored learning records
 */
async function keywordSearchLearnings(context, limit) {
  const result = await pool.query(`
    SELECT id, title, category, trigger_event, content, strategy_adjustments, applied, created_at, metadata
    FROM learnings
    ORDER BY created_at DESC
    LIMIT 100
  `);

  return result.rows.map(learning => {
    let score = 0;
    const metadata = learning.metadata || {};
    const content = learning.content || '';
    const contentLower = content.toLowerCase();

    if (context.task_type && metadata.task_type === context.task_type) score += 10;
    if (context.failure_class) {
      if (contentLower.includes(context.failure_class.toLowerCase())) score += 8;
    }
    if (context.event_type && learning.trigger_event === context.event_type) score += 6;
    if (learning.category === 'failure_pattern') score += 4;

    const ageInDays = (Date.now() - new Date(learning.created_at).getTime()) / 86400000;
    if (ageInDays <= 7) score += 3;
    else if (ageInDays <= 30) score += 2;
    else score += 1;

    return { ...learning, relevance_score: score };
  }).sort((a, b) => b.relevance_score - a.relevance_score).slice(0, limit);
}

/**
 * Calculate keyword boost for a learning record
 * @param {Object} learning - Learning record
 * @param {Object} context - Search context
 * @returns {number} Boost score
 */
function keywordBoost(learning, context = {}) {
  let boost = 0;
  const metadata = learning.metadata || {};
  const content = learning.content || '';
  const contentLower = content.toLowerCase();

  if (context.task_type && metadata.task_type === context.task_type) boost += 5;
  if (context.failure_class && contentLower.includes(context.failure_class.toLowerCase())) boost += 4;
  if (context.event_type && learning.trigger_event === context.event_type) boost += 3;
  if (learning.category === 'failure_pattern') boost += 2;

  return boost;
}

/**
 * Get recent learnings (fallback / backward compatibility)
 * @param {string} category - Learning category filter (optional)
 * @param {number} limit - Maximum number of results
 * @returns {Promise<Array>} - Learning records
 */
export async function getRecentLearnings(category = null, limit = 10) {
  try {
    let query = `
      SELECT id, title, category, trigger_event, content, strategy_adjustments, applied, created_at, metadata
      FROM learnings
    `;
    const params = [];

    if (category) {
      query += ` WHERE category = $1`;
      params.push(category);
      query += ` ORDER BY created_at DESC LIMIT $2`;
      params.push(limit);
    } else {
      query += ` ORDER BY created_at DESC LIMIT $1`;
      params.push(limit);
    }

    const result = await pool.query(query, params);
    return result.rows;
  } catch (err) {
    console.error(`[learning] Failed to get recent learnings: ${err.message}`);
    return [];
  }
}

export { vectorSearchLearnings as _vectorSearchLearnings, keywordSearchLearnings as _keywordSearchLearnings, keywordBoost as _keywordBoost };
