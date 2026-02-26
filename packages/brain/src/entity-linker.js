/**
 * Entity Linker — OKR/Task 实体链接
 *
 * 将用户模糊表达自动关联到已有的 Goal/Project：
 * 1. 关键词匹配（零 LLM 成本，优先）
 * 2. 未来可扩展向量搜索
 */

/* global console */

import pool from './db.js';

/**
 * 在 goals 表中查找与文本匹配的目标
 * @param {string} text - 搜索文本
 * @returns {Promise<{id: string, title: string}|null>}
 */
export async function findRelatedGoal(text) {
  if (!text || text.length < 2) return null;

  try {
    const keywords = extractKeywords(text);
    if (keywords.length === 0) return null;

    // 用关键词逐个匹配 goals 表（ILIKE），返回第一个匹配
    for (const kw of keywords) {
      const result = await pool.query(
        `SELECT id, title FROM goals
         WHERE status IN ('in_progress', 'pending', 'ready', 'reviewing', 'decomposing')
           AND title ILIKE $1
         ORDER BY priority ASC
         LIMIT 1`,
        [`%${kw}%`]
      );
      if (result.rows.length > 0) return result.rows[0];
    }

    return null;
  } catch (err) {
    console.warn('[entity-linker] findRelatedGoal failed:', err.message);
    return null;
  }
}

/**
 * 在 projects 表中查找与文本匹配的项目
 * @param {string} text - 搜索文本
 * @returns {Promise<{id: string, name: string}|null>}
 */
export async function findRelatedProject(text) {
  if (!text || text.length < 2) return null;

  try {
    const keywords = extractKeywords(text);
    if (keywords.length === 0) return null;

    for (const kw of keywords) {
      const result = await pool.query(
        `SELECT id, name FROM projects
         WHERE name ILIKE $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [`%${kw}%`]
      );
      if (result.rows.length > 0) return result.rows[0];
    }

    return null;
  } catch (err) {
    console.warn('[entity-linker] findRelatedProject failed:', err.message);
    return null;
  }
}

/**
 * 综合链接：尝试匹配 goal 和 project
 * @param {Object|null} llmIntent - LLM 解析的意图 {entities, summary}
 * @param {string} [fallbackText=''] - 原始消息（当 llmIntent 不可用时）
 * @returns {Promise<{goal_id: string|null, project_id: string|null}>}
 */
export async function linkEntities(llmIntent = null, fallbackText = '') {
  const searchText = (llmIntent && (llmIntent.summary || (llmIntent.entities && llmIntent.entities.title))) || fallbackText;
  if (!searchText) return { goal_id: null, project_id: null };

  const [goal, project] = await Promise.all([
    findRelatedGoal(searchText),
    findRelatedProject(searchText),
  ]);

  return {
    goal_id: goal ? goal.id : null,
    project_id: project ? project.id : null,
  };
}

/**
 * 从文本中提取有意义的关键词（排除停用词）
 * @param {string} text
 * @returns {string[]}
 */
function extractKeywords(text) {
  const stopWords = new Set([
    '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
    '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
    '这', '那', '这个', '那个', '什么', '怎么', '哪', '谁', '多少', '几',
    '想', '做', '搞', '弄', '把', '给', '让', '加', '改', '修',
    'the', 'a', 'an', 'is', 'are', 'was', 'be', 'to', 'of', 'and', 'in', 'that', 'it',
    'for', 'on', 'with', 'as', 'at', 'by', 'from', 'or', 'but', 'not', 'this', 'have',
  ]);

  // 提取中文词（2-8字）和英文单词（2+字）
  const tokens = [];

  // 英文单词
  const engMatches = text.match(/[a-zA-Z][\w-]{1,}/g) || [];
  for (const w of engMatches) {
    if (!stopWords.has(w.toLowerCase())) tokens.push(w);
  }

  // 中文：滑动窗口提取 2-4 字片段
  const chineseOnly = text.replace(/[a-zA-Z0-9\s\p{P}]/gu, '');
  if (chineseOnly.length >= 2) {
    // 先尝试整段中文（去掉停用字符后）
    const cleaned = [...chineseOnly].filter(c => !stopWords.has(c)).join('');
    if (cleaned.length >= 2 && cleaned.length <= 8) {
      tokens.push(cleaned);
    }
    // 再取 2-4 字片段
    for (let len = Math.min(4, chineseOnly.length); len >= 2; len--) {
      for (let i = 0; i <= chineseOnly.length - len; i++) {
        const seg = chineseOnly.slice(i, i + len);
        if (![...seg].some(c => stopWords.has(c))) {
          tokens.push(seg);
        }
      }
    }
  }

  // 去重，保留顺序
  return [...new Set(tokens)].slice(0, 5);
}

export { extractKeywords as _extractKeywords };
