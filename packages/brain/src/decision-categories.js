/**
 * decisions 表枚举字段允许值 —— JS 侧唯一一份（INV-76cb816c）
 *
 * 与数据库 CHECK 约束逐字一致，由 routes/__tests__/strategic-decisions-category.test.js 漂移守卫锁死：
 *   category  ← migrations/384_decisions_nfr_category.sql（decisions_category_chk，另允许 NULL）
 *   made_by   ← migrations/193_knowledge_doc_author.sql（decisions_made_by_check）
 *   priority  ← migrations/193_knowledge_doc_author.sql（decisions_priority_check）
 */

export const DECISION_CATEGORIES = Object.freeze([
  'architecture',
  'bug-fix',
  'decision',
  'deployment',
  'feature',
  'governance',
  'infra',
  'invariant',
  'judgment',
  'nfr',
  'small-change',
  'technical',
  'testing',
]);

export const DEFAULT_DECISION_CATEGORY = 'decision';

export const DECISION_MADE_BY = Object.freeze(['user', 'cecelia', 'system']);

export const DECISION_PRIORITIES = Object.freeze(['P0', 'P1', 'P2', 'P3']);

export function isValidDecisionCategory(v) {
  return typeof v === 'string' && DECISION_CATEGORIES.includes(v);
}
