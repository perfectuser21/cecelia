/**
 * Similarity Service - Phase 0 + Phase 1 Implementation
 *
 * Phase 0: Jaccard similarity (intersection / union of tokens)
 * Phase 1: OpenAI embeddings + pgvector (semantic search)
 *
 * Hybrid search: 70% vector similarity + 30% Jaccard similarity
 */

import pool from './db.js';
import { generateEmbedding } from './openai-client.js';

class SimilarityService {
  constructor(db) {
    this.db = db || pool;
  }

  /**
   * Search for similar entities (Tasks/Initiatives/KRs)
   * @param {string} query - User input query
   * @param {number} topK - Number of top matches to return
   * @param {Object} filters - Optional filters for search
   * @param {string} filters.repo - Filter by repository name
   * @param {number} filters.project_id - Filter by project ID
   * @param {string} filters.date_from - Filter by creation date (ISO format)
   * @param {string} filters.date_to - Filter by creation date (ISO format)
   * @returns {Promise<{matches: Array}>}
   */
  async searchSimilar(query, topK = 5, filters = {}) {
    // 1. Query all active entities
    const entities = await this.getAllActiveEntities(filters);

    // 2. Calculate similarity scores
    const scored = entities.map(entity => ({
      ...entity,
      score: this.calculateScore(query, entity)
    }));

    // 3. Sort and take top K
    const topMatches = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .filter(m => m.score > 0.3);  // Filter out very low scores

    return { matches: topMatches };
  }

  /**
   * Get all active entities from database
   * @param {Object} filters - Optional filters
   * @param {string} filters.repo - Filter by repository name (metadata->>'repo')
   * @param {number} filters.project_id - Filter by project ID
   * @param {string} filters.date_from - Filter by creation date (ISO format)
   * @param {string} filters.date_to - Filter by creation date (ISO format)
   * @param {number} filters.limit - Maximum number of results (default 1000)
   * @returns {Promise<Array>}
   */
  async getAllActiveEntities(filters = {}) {
    const entities = [];
    const { repo, project_id, date_from, date_to, limit = 1000 } = filters;

    // Build WHERE clause dynamically
    const taskWhereClauses = ["t.status IN ('pending', 'in_progress', 'completed')"];
    const taskQueryParams = [];
    let paramIndex = 1;

    if (repo) {
      taskWhereClauses.push(`t.metadata->>'repo' = $${paramIndex}`);
      taskQueryParams.push(repo);
      paramIndex++;
    }

    if (project_id) {
      taskWhereClauses.push(`t.project_id = $${paramIndex}`);
      taskQueryParams.push(project_id);
      paramIndex++;
    }

    if (date_from) {
      taskWhereClauses.push(`t.created_at >= $${paramIndex}`);
      taskQueryParams.push(date_from);
      paramIndex++;
    }

    if (date_to) {
      taskWhereClauses.push(`t.created_at <= $${paramIndex}`);
      taskQueryParams.push(date_to);
      paramIndex++;
    }

    const taskWhereClause = taskWhereClauses.join(' AND ');

    // Query Tasks with filters
    const tasksResult = await this.db.query(`
      SELECT
        t.id, t.title, t.description, t.status, t.metadata, t.project_id,
        pp.project_id as initiative_id, pp.title as pr_plan_title,
        p.name as initiative_title
      FROM tasks t
      LEFT JOIN pr_plans pp ON t.pr_plan_id = pp.id
      LEFT JOIN projects p ON pp.project_id = p.id
      WHERE ${taskWhereClause}
      ORDER BY t.updated_at DESC
      LIMIT $${paramIndex}
    `, [...taskQueryParams, limit]);

    tasksResult.rows.forEach(task => {
      // Parse metadata if it's a JSON string
      let parsedMetadata = {};
      if (task.metadata) {
        parsedMetadata = typeof task.metadata === 'string' ? JSON.parse(task.metadata) : task.metadata;
      }

      entities.push({
        level: 'task',
        id: task.id,
        title: task.title,
        description: task.description || '',
        status: task.status,
        text: `${task.title} ${task.description || ''}`,
        project_id: task.project_id,
        metadata: {
          initiative_id: task.initiative_id,
          initiative_title: task.initiative_title,
          pr_plan_title: task.pr_plan_title,
          repo: parsedMetadata.repo || null,
          pr_number: parsedMetadata.pr_number || null,
          pr_author: parsedMetadata.pr_author || null
        }
      });
    });

    // Query Initiatives (Sub-Projects, most recent 50)
    const initiativesResult = await this.db.query(`
      SELECT
        p.id, p.name as title, p.description, p.status,
        kr.id as kr_id, kr.title as kr_title
      FROM projects p
      LEFT JOIN project_kr_links pkl ON p.id = pkl.project_id
      LEFT JOIN goals kr ON pkl.kr_id = kr.id AND kr.type = 'kr'
      WHERE p.parent_id IS NOT NULL AND p.status IN ('active', 'in_progress')
      ORDER BY p.updated_at DESC
      LIMIT 50
    `);

    initiativesResult.rows.forEach(initiative => {
      entities.push({
        level: 'initiative',
        id: initiative.id,
        title: initiative.title,  // from p.name
        description: initiative.description || '',
        status: initiative.status,
        text: `${initiative.title} ${initiative.description || ''}`,
        metadata: {
          kr_id: initiative.kr_id,
          kr_title: initiative.kr_title
        }
      });
    });

    // Query KRs (most recent 30)
    // TODO: Disabled until key_results table schema is finalized
    // Current schema uses goals table with type='key_result', but fields differ
    /*
    const krsResult = await this.db.query(`
      SELECT
        kr.id, kr.title, kr.target_value, kr.current_value, kr.unit, kr.status,
        g.id as goal_id, g.title as goal_title
      FROM key_results kr
      LEFT JOIN goals g ON kr.goal_id = g.id AND g.type IN ('global_okr', 'area_okr')
      WHERE kr.status IN ('active', 'in_progress')
      ORDER BY kr.updated_at DESC
      LIMIT 30
    `);

    krsResult.rows.forEach(kr => {
      // Build text: combine title with target/current values
      const valueText = kr.target_value ?
        `target: ${kr.current_value || 0}/${kr.target_value} ${kr.unit || ''}` : '';

      entities.push({
        level: 'kr',
        id: kr.id,
        title: kr.title,
        description: valueText,
        status: kr.status,
        text: `${kr.title} ${valueText}`,
        metadata: {
          goal_id: kr.goal_id,
          goal_title: kr.goal_title,
          target_value: kr.target_value,
          current_value: kr.current_value,
          unit: kr.unit
        }
      });
    });
    */

    return entities;
  }

  /**
   * Calculate similarity score between query and entity
   * @param {string} query - User query
   * @param {Object} entity - Entity with text field
   * @returns {number} Similarity score (0.0-1.0)
   */
  calculateScore(query, entity) {
    const queryTokens = this.tokenize(query);
    const entityTokens = this.tokenize(entity.text);

    // 1. Jaccard similarity
    const intersection = queryTokens.filter(t => entityTokens.includes(t));
    const union = new Set([...queryTokens, ...entityTokens]);
    const jaccard = intersection.length / union.size;

    // 2. Keyword boost
    let keywordBoost = 0;
    const importantWords = this.extractKeywords(query);
    importantWords.forEach(kw => {
      if (entity.text.includes(kw)) {
        keywordBoost += 0.1;
      }
    });

    // 3. Status penalty (completed tasks get lower priority)
    let statusPenalty = 0;
    if (entity.level === 'task' && entity.status === 'completed') {
      statusPenalty = -0.1;
    }

    // Combined score
    return Math.min(1.0, jaccard + keywordBoost + statusPenalty);
  }

  /**
   * Tokenize text into words
   * @param {string} text
   * @returns {Array<string>}
   */
  tokenize(text) {
    if (!text) return [];
    return text.toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fa5]/g, ' ')  // Keep Chinese characters
      .split(/\s+/)
      .filter(t => t.length > 1);
  }

  /**
   * Extract keywords from text (remove stopwords)
   * @param {string} text
   * @returns {Array<string>}
   */
  extractKeywords(text) {
    const tokens = this.tokenize(text);
    const stopwords = ['的', '是', '在', '和', '了', '有', 'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at'];
    return tokens.filter(t => !stopwords.includes(t));
  }

  /**
   * Search with vector embeddings (Phase 1)
   * @param {string} query - User query
   * @param {Object} options - Search options
   * @param {number} options.topK - Number of results (default: 5)
   * @param {string} options.repo - Filter by single repo
   * @param {string[]} options.repos - Filter by multiple repos
   * @param {string} options.status - Filter by status
   * @param {string} options.dateFrom - Filter by date range (ISO format)
   * @param {string} options.dateTo - Filter by date range (ISO format)
   * @param {number} options.hybridWeight - Vector weight vs Jaccard (default: 0.7)
   * @param {boolean} options.fallbackToJaccard - Fallback to Jaccard if OpenAI fails (default: true)
   * @returns {Promise<{matches: Array}>}
   */
  async searchWithVectors(query, options = {}) {
    const {
      topK = 5,
      repo = null,
      repos = [],
      status = null,
      dateFrom = null,
      dateTo = null,
      hybridWeight = 0.7,
      fallbackToJaccard = true
    } = options;

    // 1. Generate query embedding
    let queryEmbedding;
    try {
      queryEmbedding = await generateEmbedding(query);
    } catch (error) {
      console.error('OpenAI API failed:', error.message);
      if (fallbackToJaccard) {
        console.warn('Falling back to Jaccard similarity');
        return this.searchSimilar(query, topK, { repo, status, date_from: dateFrom, date_to: dateTo });
      }
      throw error;
    }

    // 2. Build filters
    const filters = {
      repo: repo || (repos.length > 0 ? repos : null),
      status,
      date_from: dateFrom,
      date_to: dateTo,
      limit: topK * 3  // Get more candidates for hybrid ranking
    };

    // 3. Vector search
    const vectorResults = await this.vectorSearch(queryEmbedding, filters);

    // 4. Jaccard search (for hybrid)
    const jaccardResults = await this.searchSimilar(query, topK * 3, filters);

    // 5. Merge results (hybrid)
    const hybridResults = this.mergeResults(vectorResults.matches, jaccardResults.matches, hybridWeight);

    // 6. Return top K
    return {
      matches: hybridResults.slice(0, topK)
    };
  }

  /**
   * Vector search using pgvector
   * @param {number[]} queryEmbedding - Query embedding vector (1536 dimensions)
   * @param {Object} filters - Filters (repo, status, date)
   * @returns {Promise<{matches: Array}>}
   */
  async vectorSearch(queryEmbedding, filters = {}) {
    const matches = [];
    const { repo, status, date_from, date_to, limit = 15 } = filters;

    // Convert embedding to PostgreSQL vector format
    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    // Build WHERE clauses
    const whereClauses = ['t.embedding IS NOT NULL'];
    const queryParams = [embeddingStr];
    let paramIndex = 2;

    // Repo filter (single or multiple)
    if (repo) {
      if (Array.isArray(repo)) {
        whereClauses.push(`t.metadata->>'repo' = ANY($${paramIndex})`);
        queryParams.push(repo);
      } else {
        whereClauses.push(`t.metadata->>'repo' = $${paramIndex}`);
        queryParams.push(repo);
      }
      paramIndex++;
    }

    if (status) {
      whereClauses.push(`t.status = $${paramIndex}`);
      queryParams.push(status);
      paramIndex++;
    }

    if (date_from) {
      whereClauses.push(`t.created_at >= $${paramIndex}`);
      queryParams.push(date_from);
      paramIndex++;
    }

    if (date_to) {
      whereClauses.push(`t.created_at <= $${paramIndex}`);
      queryParams.push(date_to);
      paramIndex++;
    }

    const whereClause = whereClauses.join(' AND ');

    // Query tasks
    const tasksQuery = `
      SELECT
        t.id, t.title, t.description, t.status, t.metadata, t.project_id,
        1 - (t.embedding <=> $1::vector) AS vector_score
      FROM tasks t
      WHERE ${whereClause}
      ORDER BY t.embedding <=> $1::vector
      LIMIT $${paramIndex}
    `;

    const tasksResult = await this.db.query(tasksQuery, [...queryParams, limit]);

    tasksResult.rows.forEach(task => {
      let parsedMetadata = {};
      if (task.metadata) {
        parsedMetadata = typeof task.metadata === 'string' ? JSON.parse(task.metadata) : task.metadata;
      }

      matches.push({
        level: 'task',
        id: task.id,
        title: task.title,
        description: task.description || '',
        status: task.status,
        score: task.vector_score,
        metadata: {
          repo: parsedMetadata.repo || null,
          pr_number: parsedMetadata.pr_number || null,
          pr_author: parsedMetadata.pr_author || null
        }
      });
    });

    // TODO: Add vector search for projects and goals (similar queries)

    return { matches };
  }

  /**
   * Merge vector and Jaccard results using weighted scoring
   * @param {Array} vectorResults - Results from vector search
   * @param {Array} jaccardResults - Results from Jaccard search
   * @param {number} vectorWeight - Weight for vector score (default: 0.7)
   * @returns {Array} Merged and sorted results
   */
  mergeResults(vectorResults, jaccardResults, vectorWeight = 0.7) {
    const jaccardWeight = 1 - vectorWeight;

    // Create a map of id -> combined score
    const scoreMap = new Map();
    const entityMap = new Map();

    // Add vector results
    vectorResults.forEach(result => {
      const id = `${result.level}-${result.id}`;
      scoreMap.set(id, (result.score || 0) * vectorWeight);
      entityMap.set(id, result);
    });

    // Add Jaccard results
    jaccardResults.forEach(result => {
      const id = `${result.level}-${result.id}`;
      const existingScore = scoreMap.get(id) || 0;
      const jaccardScore = (result.score || 0) * jaccardWeight;
      scoreMap.set(id, existingScore + jaccardScore);

      if (!entityMap.has(id)) {
        entityMap.set(id, result);
      }
    });

    // Combine and sort
    const combined = Array.from(scoreMap.entries()).map(([id, score]) => ({
      ...entityMap.get(id),
      score
    }));

    return combined.sort((a, b) => b.score - a.score);
  }
}

export default SimilarityService;
