/**
 * Similarity Service - Phase 0 Implementation
 *
 * Simple similarity calculation using:
 * - Jaccard similarity (intersection / union of tokens)
 * - Keyword weighting
 * - Status penalty for completed tasks
 *
 * Phase 1 will upgrade to embeddings (not in this implementation).
 */

import pool from './db.js';

class SimilarityService {
  constructor(db) {
    this.db = db || pool;
  }

  /**
   * Search for similar entities (Tasks/Initiatives/KRs)
   * @param {string} query - User input query
   * @param {number} topK - Number of top matches to return
   * @returns {Promise<{matches: Array}>}
   */
  async searchSimilar(query, topK = 5) {
    // 1. Query all active entities
    const entities = await this.getAllActiveEntities();

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
   * @returns {Promise<Array>}
   */
  async getAllActiveEntities() {
    const entities = [];

    // Query Tasks (most recent 100)
    const tasksResult = await this.db.query(`
      SELECT
        t.id, t.title, t.description, t.status,
        pp.initiative_id, pp.title as pr_plan_title,
        f.title as initiative_title
      FROM tasks t
      LEFT JOIN pr_plans pp ON t.pr_plan_id = pp.id
      LEFT JOIN features f ON pp.initiative_id = f.id
      WHERE t.status IN ('pending', 'in_progress', 'completed')
      ORDER BY t.updated_at DESC
      LIMIT 100
    `);

    tasksResult.rows.forEach(task => {
      entities.push({
        level: 'task',
        id: task.id,
        title: task.title,
        description: task.description || '',
        status: task.status,
        text: `${task.title} ${task.description || ''}`,
        metadata: {
          initiative_id: task.initiative_id,
          initiative_title: task.initiative_title,
          pr_plan_title: task.pr_plan_title
        }
      });
    });

    // Query Initiatives (most recent 50)
    const initiativesResult = await this.db.query(`
      SELECT
        f.id, f.title, f.description, f.status,
        kr.id as kr_id, kr.title as kr_title
      FROM features f
      LEFT JOIN key_results kr ON f.kr_id = kr.id
      WHERE f.status IN ('active', 'in_progress')
      ORDER BY f.updated_at DESC
      LIMIT 50
    `);

    initiativesResult.rows.forEach(initiative => {
      entities.push({
        level: 'initiative',
        id: initiative.id,
        title: initiative.title,
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
    const krsResult = await this.db.query(`
      SELECT
        kr.id, kr.title, kr.description, kr.status,
        o.id as okr_id, o.objective
      FROM key_results kr
      LEFT JOIN okrs o ON kr.okr_id = o.id
      WHERE kr.status IN ('active', 'in_progress')
      ORDER BY kr.updated_at DESC
      LIMIT 30
    `);

    krsResult.rows.forEach(kr => {
      entities.push({
        level: 'kr',
        id: kr.id,
        title: kr.title,
        description: kr.description || '',
        status: kr.status,
        text: `${kr.title} ${kr.description || ''}`,
        metadata: {
          okr_id: kr.okr_id,
          okr_objective: kr.objective
        }
      });
    });

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
}

export default SimilarityService;
