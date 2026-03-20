/**
 * Decisions Context — 查询活跃决策并生成注入 agent prompt 的摘要
 *
 * decisions 表是用户/系统决策的 SSOT。
 * executor.js 派发任务前调用 getDecisionsSummary()，
 * 将摘要拼接到 agent prompt 前，确保每个 agent 都知道当前有效决策。
 */

import pool from './db.js';

const MAX_SUMMARY_LENGTH = 500;

/**
 * 从 decisions 表查询所有 active 决策
 * @returns {Promise<Array>} 决策记录列表
 */
async function fetchActiveDecisions() {
  try {
    const result = await pool.query(
      `SELECT owner, category, topic, decision
       FROM decisions
       WHERE status = 'active'
       ORDER BY owner, category, topic`
    );
    return result.rows;
  } catch (err) {
    console.warn(`[decisions-context] 查询失败: ${err.message}`);
    return [];
  }
}

/**
 * 将决策列表按 category 分组，生成简洁摘要文本
 * @param {Array} rows - 决策记录
 * @returns {string} 摘要文本（空数组返回空字符串）
 */
function buildSummary(rows) {
  if (!rows || rows.length === 0) return '';

  const userRows = rows.filter(r => r.owner === 'user');
  const ceceliaRows = rows.filter(r => r.owner === 'cecelia');

  const lines = [];
  lines.push('## 决策摘要（自动注入，来自 decisions 表）\n');

  if (userRows.length > 0) {
    lines.push('### 用户决策（最高权限）');
    const grouped = groupByCategory(userRows);
    for (const [category, items] of Object.entries(grouped)) {
      lines.push(`**${category}**:`);
      for (const item of items) {
        lines.push(`- ${item.topic}: ${item.decision}`);
      }
    }
  }

  if (ceceliaRows.length > 0) {
    lines.push('\n### 系统决策（用户可推翻）');
    const grouped = groupByCategory(ceceliaRows);
    for (const [category, items] of Object.entries(grouped)) {
      lines.push(`**${category}**:`);
      for (const item of items) {
        lines.push(`- ${item.topic}: ${item.decision}`);
      }
    }
  }

  let summary = lines.join('\n');

  // 超长截断
  if (summary.length > MAX_SUMMARY_LENGTH) {
    summary = summary.slice(0, MAX_SUMMARY_LENGTH) + '\n...(决策过多已截断)';
  }

  return summary;
}

/**
 * 按 category 分组
 */
function groupByCategory(rows) {
  const grouped = {};
  for (const row of rows) {
    const cat = row.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(row);
  }
  return grouped;
}

/**
 * 获取决策摘要文本，用于注入 agent prompt
 * @returns {Promise<string>} 摘要文本（无决策时返回空字符串）
 */
export async function getDecisionsSummary() {
  const rows = await fetchActiveDecisions();
  return buildSummary(rows);
}

// 导出内部函数用于测试
export const _buildSummary = buildSummary;
export const _fetchActiveDecisions = fetchActiveDecisions;
