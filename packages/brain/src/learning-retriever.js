/**
 * Learning Retriever - Inject relevant historical learnings into task dispatch prompts
 *
 * On each task dispatch, queries the learnings table using keyword scoring to find
 * relevant past experience, groups by learning_type, and returns a formatted context
 * block for injection into the agent prompt.
 */

import pool from './db.js';

// Scoring constants
const SCORE_MAX = 31; // task_type(10) + domain(6) + title_kw(8) + category(4) + age(3)
const SCORE_THRESHOLD = 0.3; // normalizedScore threshold
const MAX_INJECT = 3; // maximum learnings to inject

const TYPE_LABELS = {
  trap: '⚠️ 陷阱',
  architecture_decision: '🏗️ 架构决策',
  process_improvement: '⚙️ 流程改进',
  failure_pattern: '❌ 失败模式',
  best_practice: '✅ 最佳实践',
};

/** Returns recency bonus based on age in days */
function getAgeBonus(createdAt) {
  const ageInDays = (Date.now() - new Date(createdAt).getTime()) / 86400000;
  if (ageInDays <= 7) return 3;
  if (ageInDays <= 30) return 2;
  return 1;
}

/** Scores a single learning row against the current task context */
function scoreRow(row, taskType, domain, titleWords) {
  const meta = row.metadata || {};
  const contentLower = (row.content || '').toLowerCase();
  let rawScore = 0;

  if (meta.task_type === taskType) rawScore += 10;
  if (domain && meta.domain === domain) rawScore += 6;

  const kwMatches = titleWords.filter(w => contentLower.includes(w)).length;
  rawScore += Math.min(kwMatches * 2, 8);

  if (row.category === 'failure_pattern') rawScore += 4;
  rawScore += getAgeBonus(row.created_at);

  return { ...row, normalizedScore: rawScore / SCORE_MAX };
}

/** Groups an array of learning records by learning_type */
function groupByType(learnings) {
  const byType = {};
  for (const r of learnings) {
    const ltype = r.learning_type || r.category || 'best_practice';
    if (!byType[ltype]) byType[ltype] = [];
    byType[ltype].push(r);
  }
  return byType;
}

/** Formats a single learning-type section as markdown */
function formatSection(ltype, records) {
  const label = TYPE_LABELS[ltype] || ltype;
  const items = records
    .map(r => `- **${r.title}**\n  ${(r.content || '').slice(0, 300).replace(/\n+/g, ' ')}`)
    .join('\n');
  return `### ${label}\n${items}`;
}

/** Queries DB for recent learnings and warns on slow queries */
async function queryLearnings(taskId) {
  const start = Date.now();
  const result = await pool.query(`
    SELECT id, title, content, learning_type, category, metadata, created_at
    FROM learnings
    WHERE is_latest = true
    ORDER BY created_at DESC
    LIMIT 80
  `);
  const elapsed = Date.now() - start;
  if (elapsed > 200) {
    console.warn(`[learning-retriever] slow query: ${elapsed}ms (task=${taskId})`);
  }
  return result.rows;
}

/** Scores, filters, and ranks rows; returns top MAX_INJECT learnings */
function selectTopLearnings(rows, taskType, domain, titleWords) {
  return rows
    .map(row => scoreRow(row, taskType, domain, titleWords))
    .filter(r => r.normalizedScore > SCORE_THRESHOLD)
    .sort((a, b) => b.normalizedScore - a.normalizedScore)
    .slice(0, MAX_INJECT);
}

/** Formats top learnings into an injectable markdown block */
function formatContext(topLearnings) {
  const byType = groupByType(topLearnings);
  const sections = Object.entries(byType).map(([ltype, records]) => formatSection(ltype, records));
  return `\n\n## 📖 相关历史 Learning（避免重复踩坑）\n\n${sections.join('\n\n')}`;
}

/**
 * Build a learning context string to inject into task prompts.
 * Queries learnings table, scores by keyword relevance, returns formatted block.
 *
 * @param {Object} task - Task object from DB (task_type, title, domain, etc.)
 * @returns {Promise<string>} Formatted learning context block, or '' if none qualify
 */
export async function buildLearningContext(task) {
  try {
    const taskType = task.task_type || 'dev';
    const titleWords = (task.title || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const domain = task.domain || '';

    const rows = await queryLearnings(task.id);
    const topLearnings = selectTopLearnings(rows, taskType, domain, titleWords);
    if (topLearnings.length === 0) return '';
    return formatContext(topLearnings);
  } catch (err) {
    console.warn(`[learning-retriever] retrieval failed: ${err.message} (task=${task.id})`);
    return '';
  }
}
