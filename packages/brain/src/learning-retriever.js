/**
 * Learning Retriever - Inject relevant historical learnings into task dispatch prompts
 *
 * On each task dispatch, queries the learnings table using keyword scoring to find
 * relevant past experience, groups by learning_type, and returns a formatted context
 * block for injection into the agent prompt.
 */

/* global console */
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

/**
 * Build a learning context string to inject into task prompts.
 * Queries learnings table, scores by keyword relevance, returns formatted block.
 *
 * @param {Object} task - Task object from DB (task_type, title, domain, etc.)
 * @returns {Promise<string>} Formatted learning context block, or '' if none qualify
 */
export async function buildLearningContext(task) {
  const start = Date.now();
  try {
    const taskType = task.task_type || 'dev';
    const titleLower = (task.title || '').toLowerCase();
    const domain = task.domain || '';

    const result = await pool.query(`
      SELECT id, title, content, learning_type, category, metadata, created_at
      FROM learnings
      WHERE is_latest = true
      ORDER BY created_at DESC
      LIMIT 80
    `);

    const elapsed = Date.now() - start;
    if (elapsed > 200) {
      console.warn(`[learning-retriever] slow query: ${elapsed}ms (task=${task.id})`);
    }

    // Score each learning record
    const titleWords = titleLower.split(/\s+/).filter(w => w.length > 3);

    const scored = result.rows.map(row => {
      let rawScore = 0;
      const meta = row.metadata || {};
      const contentLower = (row.content || '').toLowerCase();

      // Task type match (+10)
      if (meta.task_type === taskType) rawScore += 10;
      // Domain match (+6)
      if (domain && meta.domain === domain) rawScore += 6;
      // Title keyword overlap (max +8, +2 per word)
      const kwMatches = titleWords.filter(w => contentLower.includes(w)).length;
      rawScore += Math.min(kwMatches * 2, 8);
      // Category: failure_pattern bonus (+4)
      if (row.category === 'failure_pattern') rawScore += 4;
      // Age recency bonus
      const ageInDays = (Date.now() - new Date(row.created_at).getTime()) / 86400000;
      rawScore += ageInDays <= 7 ? 3 : ageInDays <= 30 ? 2 : 1;

      return { ...row, normalizedScore: rawScore / SCORE_MAX };
    });

    const topLearnings = scored
      .filter(r => r.normalizedScore > SCORE_THRESHOLD)
      .sort((a, b) => b.normalizedScore - a.normalizedScore)
      .slice(0, MAX_INJECT);

    if (topLearnings.length === 0) return '';

    // Group by learning_type
    const byType = {};
    for (const r of topLearnings) {
      const ltype = r.learning_type || r.category || 'best_practice';
      if (!byType[ltype]) byType[ltype] = [];
      byType[ltype].push(r);
    }

    const sections = Object.entries(byType).map(([ltype, records]) => {
      const label = TYPE_LABELS[ltype] || ltype;
      const items = records
        .map(r => `- **${r.title}**\n  ${(r.content || '').slice(0, 300).replace(/\n+/g, ' ')}`)
        .join('\n');
      return `### ${label}\n${items}`;
    });

    return `\n\n## 📖 相关历史 Learning（避免重复踩坑）\n\n${sections.join('\n\n')}`;
  } catch (err) {
    console.warn(`[learning-retriever] retrieval failed: ${err.message} (task=${task.id})`);
    return '';
  }
}
