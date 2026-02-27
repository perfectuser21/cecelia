/**
 * Suggestion Triage System
 *
 * 实现对 Agent 返回的 suggestions 进行优先级评分、去重和队列处理
 */

import pool from './db.js';
import { emit } from './event-bus.js';

// 优先级权重配置
const PRIORITY_WEIGHTS = {
  source: {
    cortex: 0.9,      // 高级决策层建议权重高
    thalamus: 0.7,    // 中级路由层建议
    executor: 0.6,    // 执行层建议
    default: 0.5      // 默认权重
  },
  type: {
    alert: 0.95,      // 警告类建议最高优先级
    task_creation: 0.8, // 任务创建建议
    optimization: 0.6,  // 优化建议
    general: 0.5      // 普通建议
  },
  freshness: {
    maxAge: 24 * 60 * 60 * 1000, // 24小时，超过后权重递减
    decayRate: 0.1                // 每小时权重衰减率
  }
};

/**
 * 计算建议的优先级评分
 * @param {Object} suggestion - 建议对象
 * @returns {number} 0-1 的优先级评分
 */
function calculatePriorityScore(suggestion) {
  let score = 0.5; // 基础分数

  // 来源权重（支持完整匹配和包含匹配，e.g. 'integration-test-cortex' → cortex 权重）
  const src = (suggestion.source || '').toLowerCase();
  let sourceWeight = PRIORITY_WEIGHTS.source.default;
  for (const [key, weight] of Object.entries(PRIORITY_WEIGHTS.source)) {
    if (key !== 'default' && src.includes(key)) { sourceWeight = weight; break; }
  }
  score = score * 0.5 + sourceWeight * 0.5;

  // 类型权重
  const typeWeight = PRIORITY_WEIGHTS.type[suggestion.suggestion_type] || PRIORITY_WEIGHTS.type.general;
  score = score * 0.6 + typeWeight * 0.4;

  // 时效性权重（新建议权重更高）
  const ageMs = Date.now() - new Date(suggestion.created_at).getTime();
  const ageHours = ageMs / (60 * 60 * 1000);
  const freshnessWeight = Math.max(0.1, 1 - (ageHours * PRIORITY_WEIGHTS.freshness.decayRate));
  score = score * 0.8 + freshnessWeight * 0.2;

  // 确保分数在 0-1 范围内
  return Math.max(0, Math.min(1, score));
}

/**
 * 检查两个建议是否相似（用于去重）
 * @param {Object} suggestion1
 * @param {Object} suggestion2
 * @returns {boolean} 是否相似
 */
function areSuggestionsSimil(suggestion1, suggestion2) {
  // 基本去重逻辑：相同来源、相同类型、相同目标实体
  if (suggestion1.source === suggestion2.source &&
      suggestion1.suggestion_type === suggestion2.suggestion_type &&
      suggestion1.target_entity_type === suggestion2.target_entity_type &&
      suggestion1.target_entity_id === suggestion2.target_entity_id) {

    const c1 = suggestion1.content.toLowerCase();
    const c2 = suggestion2.content.toLowerCase();

    // 子字符串包含检查（支持中文）：一个包含另一个且覆盖率 > 70%
    if (c1.includes(c2) || c2.includes(c1)) {
      const shorter = Math.min(c1.length, c2.length);
      const longer = Math.max(c1.length, c2.length);
      if (shorter / longer > 0.7) return true;
    }

    // 词级别相似度（英文多词文本）
    const words1 = c1.split(/\s+/).filter(w => w.length > 0);
    const words2 = c2.split(/\s+/).filter(w => w.length > 0);
    if (words1.length > 1 || words2.length > 1) {
      const common = words1.filter(w => words2.includes(w));
      return common.length / Math.max(words1.length, words2.length) > 0.7;
    }

    // 字符集相似度（中文单句）
    const chars1 = new Set([...c1]);
    const chars2 = new Set([...c2]);
    const commonChars = [...chars1].filter(c => chars2.has(c));
    return commonChars.length / Math.max(chars1.size, chars2.size) > 0.7;
  }

  return false;
}

/**
 * 创建新的建议
 * @param {Object} suggestionData - 建议数据
 * @returns {Object} 创建的建议对象
 */
export async function createSuggestion(suggestionData) {
  const {
    content,
    source,
    agent_id,
    suggestion_type = 'general',
    target_entity_type,
    target_entity_id,
    metadata = {}
  } = suggestionData;

  // 计算优先级评分
  const tempSuggestion = { ...suggestionData, created_at: new Date() };
  const priority_score = calculatePriorityScore(tempSuggestion);

  const result = await pool.query(`
    INSERT INTO suggestions (
      content, source, agent_id, suggestion_type,
      target_entity_type, target_entity_id, metadata, priority_score
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `, [
    content, source, agent_id, suggestion_type,
    target_entity_type, target_entity_id, JSON.stringify(metadata), priority_score
  ]);

  const suggestion = result.rows[0];
  suggestion.priority_score = parseFloat(suggestion.priority_score);

  // 发布事件
  await emit('suggestion_created', 'suggestion_triage', {
    suggestion_id: suggestion.id,
    source: suggestion.source,
    priority_score: suggestion.priority_score,
    suggestion_type: suggestion.suggestion_type
  });

  return suggestion;
}

/**
 * 执行 triage 处理：评分、去重、排序
 * @param {number} limit - 处理的建议数量限制
 * @returns {Array} 处理后的建议列表
 */
export async function executeTriage(limit = 50) {
  console.log(`[Triage] 开始处理 suggestions，限制 ${limit} 条`);

  // 获取待处理的建议
  const pendingResult = await pool.query(`
    SELECT * FROM suggestions
    WHERE status = 'pending' AND expires_at > now()
    ORDER BY created_at DESC
    LIMIT $1
  `, [limit]);

  const pendingSuggestions = pendingResult.rows;

  if (pendingSuggestions.length === 0) {
    console.log('[Triage] 没有待处理的 suggestions');
    return [];
  }

  console.log(`[Triage] 找到 ${pendingSuggestions.length} 条待处理 suggestions`);

  // 重新计算优先级评分
  const updatedSuggestions = [];

  for (const suggestion of pendingSuggestions) {
    suggestion.priority_score = parseFloat(suggestion.priority_score);
    const newScore = calculatePriorityScore(suggestion);

    if (newScore !== suggestion.priority_score) {
      await pool.query(`
        UPDATE suggestions
        SET priority_score = $1, updated_at = now()
        WHERE id = $2
      `, [newScore, suggestion.id]);

      suggestion.priority_score = newScore;
    }

    updatedSuggestions.push(suggestion);
  }

  // 去重处理
  const deduplicatedSuggestions = [];
  const processedIds = new Set();

  for (let i = 0; i < updatedSuggestions.length; i++) {
    if (processedIds.has(updatedSuggestions[i].id)) continue;

    const currentSuggestion = updatedSuggestions[i];
    deduplicatedSuggestions.push(currentSuggestion);
    processedIds.add(currentSuggestion.id);

    // 查找相似的建议
    for (let j = i + 1; j < updatedSuggestions.length; j++) {
      if (processedIds.has(updatedSuggestions[j].id)) continue;

      if (areSuggestionsSimil (currentSuggestion, updatedSuggestions[j])) {
        // 标记重复建议为 rejected
        await pool.query(`
          UPDATE suggestions
          SET status = 'rejected', updated_at = now(),
              metadata = metadata || $1
          WHERE id = $2
        `, [
          JSON.stringify({ rejection_reason: 'duplicate', duplicate_of: currentSuggestion.id }),
          updatedSuggestions[j].id
        ]);

        processedIds.add(updatedSuggestions[j].id);
        console.log(`[Triage] 标记重复建议: ${updatedSuggestions[j].id}`);
      }
    }
  }

  // 按优先级排序
  deduplicatedSuggestions.sort((a, b) => b.priority_score - a.priority_score);

  console.log(`[Triage] 完成处理，${deduplicatedSuggestions.length} 条建议待进一步评估`);

  // 发布 triage 完成事件
  await emit('suggestions_triaged', 'suggestion_triage', {
    processed_count: pendingSuggestions.length,
    deduplicated_count: deduplicatedSuggestions.length,
    rejected_count: pendingSuggestions.length - deduplicatedSuggestions.length
  });

  return deduplicatedSuggestions;
}

/**
 * 获取优先级最高的建议
 * @param {number} limit - 返回的建议数量
 * @returns {Array} 建议列表
 */
export async function getTopPrioritySuggestions(limit = 10) {
  const result = await pool.query(`
    SELECT * FROM suggestions
    WHERE status = 'pending' AND expires_at > now()
    ORDER BY priority_score DESC, created_at DESC
    LIMIT $1
  `, [limit]);

  return result.rows.map(row => ({
    ...row,
    priority_score: parseFloat(row.priority_score)
  }));
}

/**
 * 更新建议状态
 * @param {string} suggestionId - 建议 ID
 * @param {string} status - 新状态
 * @param {Object} metadata - 额外元数据
 */
export async function updateSuggestionStatus(suggestionId, status, metadata = {}) {
  const updateFields = { status };
  if (status === 'processed') {
    updateFields.processed_at = new Date();
  }

  await pool.query(`
    UPDATE suggestions
    SET status = $1,
        processed_at = $2,
        metadata = metadata || $3,
        updated_at = now()
    WHERE id = $4
  `, [
    status,
    updateFields.processed_at || null,
    JSON.stringify(metadata),
    suggestionId
  ]);

  // 发布状态更新事件
  await emit('suggestion_status_updated', 'suggestion_triage', {
    suggestion_id: suggestionId,
    new_status: status,
    metadata
  });
}

/**
 * 清理过期的建议
 * @returns {number} 清理的建议数量
 */
export async function cleanupExpiredSuggestions() {
  const result = await pool.query(`
    UPDATE suggestions
    SET status = 'archived', updated_at = now()
    WHERE expires_at <= now() AND status = 'pending'
    RETURNING id
  `);

  const cleanupCount = result.rows.length;

  if (cleanupCount > 0) {
    console.log(`[Triage] 清理了 ${cleanupCount} 条过期建议`);

    await emit('suggestions_cleaned', 'suggestion_triage', {
      cleanup_count: cleanupCount
    });
  }

  return cleanupCount;
}

/**
 * 获取 triage 统计信息
 * @returns {Object} 统计信息
 */
export async function getTriageStats() {
  const result = await pool.query(`
    SELECT
      status,
      COUNT(*) as count,
      AVG(priority_score) as avg_priority_score
    FROM suggestions
    WHERE created_at > now() - interval '7 days'
    GROUP BY status
  `);

  const stats = {
    total: 0,
    by_status: {},
    avg_priority_by_status: {}
  };

  for (const row of result.rows) {
    stats.total += parseInt(row.count);
    stats.by_status[row.status] = parseInt(row.count);
    stats.avg_priority_by_status[row.status] = parseFloat(row.avg_priority_score);
  }

  return stats;
}