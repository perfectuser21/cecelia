/**
 * Suggestion Cycle — Desire → Suggestion Pipeline 桥接
 *
 * 将 active desires（高紧迫度）注入 suggestion pipeline，
 * 使 Brain 在推送建议时感知并引用当前欲望状态。
 *
 * 核心函数：
 * - getActiveDesiresForSuggestion(dbPool) — 查询 active desires
 * - buildSuggestionPrompt(context, desires)  — 构建含欲望上下文的 prompt
 * - runSuggestionCycle(dbPool)               — 编排：desires → suggestion 记录
 */

import pool from './db.js';
import { createSuggestion } from './suggestion-triage.js';

// urgency 阈值：≥ 7 视为高优先级欲望（对应 0-10 量表的 70%）
const DESIRE_URGENCY_THRESHOLD = 7;
// 每次最多取前 N 条 active desires
const DESIRE_LIMIT = 5;

/**
 * 查询当前 active desires（status=pending，urgency≥阈值）
 *
 * @param {import('pg').Pool} [dbPool] - 可注入 Pool（测试用）
 * @returns {Promise<Array<{id: string, type: string, content: string, urgency: number}>>}
 */
export async function getActiveDesiresForSuggestion(dbPool) {
  const db = dbPool || pool;
  const { rows } = await db.query(
    `SELECT id, type, content, proposed_action, urgency
     FROM desires
     WHERE status = 'pending'
       AND urgency >= $1
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY urgency DESC, created_at DESC
     LIMIT $2`,
    [DESIRE_URGENCY_THRESHOLD, DESIRE_LIMIT]
  );
  return rows;
}

/**
 * 构建含欲望上下文的 suggestion prompt
 *
 * @param {string} context - 当前系统上下文描述
 * @param {Array<{type: string, content: string, urgency: number}>} desires - active desires 列表
 * @returns {string} prompt 字符串
 */
export function buildSuggestionPrompt(context, desires) {
  let prompt = context;

  if (desires && desires.length > 0) {
    const desireLines = desires
      .map(d => `  - [${d.type}] ${d.content}（紧迫度 ${d.urgency}）`)
      .join('\n');
    prompt += `\n\n当前欲望状态（active desires，urgency≥${DESIRE_URGENCY_THRESHOLD}）：\n${desireLines}`;
  }

  return prompt;
}

/**
 * 执行一次 suggestion cycle：
 * 1. 获取 active desires
 * 2. 若无，跳过
 * 3. 构建 suggestion prompt（含欲望上下文）
 * 4. 为每条 desire 创建对应的 suggestion 记录
 *
 * @param {import('pg').Pool} [dbPool] - 可注入 Pool（测试用）
 * @returns {Promise<{created: number}|{skipped: string}>}
 */
export async function runSuggestionCycle(dbPool) {
  const db = dbPool || pool;

  const desires = await getActiveDesiresForSuggestion(db);
  if (desires.length === 0) {
    return { skipped: 'no_active_desires' };
  }

  let created = 0;

  for (const desire of desires) {
    const context = `Brain 自我检测：发现高优先级欲望需要转化为建议。`;
    const prompt = buildSuggestionPrompt(context, [desire]);

    await createSuggestion({
      content: prompt,
      source: 'desire_system',
      suggestion_type: desire.type === 'warn' ? 'alert' : 'insight_action',
      metadata: {
        desire_id: desire.id,
        desire_type: desire.type,
        urgency: desire.urgency,
      },
    });
    created++;
  }

  return { created };
}
