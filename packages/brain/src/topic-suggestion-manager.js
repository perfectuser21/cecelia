/**
 * topic-suggestion-manager.js
 *
 * 选题推荐队列管理器。
 *
 * 选题流程：
 *   topic-selector 生成 N 个候选
 *   → saveSuggestions 存入 topic_suggestions（status=pending，取 TOP 5）
 *   → Alex 可通过 API approveSuggestion / rejectSuggestion 审核
 *   → autoPromoteSuggestions（每 tick 调用）：pending 超过 2 小时 → auto_promoted
 *   → 审批/自动晋级后创建 content-pipeline task
 */

import _pool from './db.js';

// ─── 常量 ─────────────────────────────────────────────────────────────────────

/** 每日最多推荐给 Alex 的选题数 */
const MAX_DAILY_SUGGESTIONS = 5;

/** pending 超过此分钟数后自动晋级 */
const AUTO_PROMOTE_AFTER_MINUTES = 120;

/** 内容生成 KR goal_id（与 topic-selection-scheduler.js 保持一致） */
const CONTENT_KR_GOAL_ID = '65b4142d-242b-457d-abfa-c0c38037f1e9';

// ─── 写入 ─────────────────────────────────────────────────────────────────────

/**
 * 将选题列表的 TOP N 保存为 pending 推荐。
 * 已存在相同 (selected_date, keyword) 的记录则跳过（UPSERT 忽略冲突）。
 *
 * @param {import('pg').Pool} dbPool
 * @param {Array<{keyword, content_type, title_candidates, hook, why_hot, priority_score}>} topics
 * @param {string} [today] - YYYY-MM-DD，默认今日
 * @returns {Promise<number>} 实际插入数
 */
export async function saveSuggestions(dbPool, topics, today = toDateString(new Date())) {
  if (!topics || topics.length === 0) return 0;

  const top = topics
    .sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0))
    .slice(0, MAX_DAILY_SUGGESTIONS);

  let saved = 0;
  for (const t of top) {
    try {
      const result = await dbPool.query(
        `INSERT INTO topic_suggestions
           (selected_date, keyword, content_type, title_candidates, hook, why_hot, priority_score)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (selected_date, keyword) DO NOTHING`,
        [
          today,
          t.keyword,
          t.content_type || 'solo-company-case',
          JSON.stringify(t.title_candidates || []),
          t.hook || '',
          t.why_hot || '',
          t.priority_score ?? 0.5,
        ]
      );
      if (result.rowCount > 0) saved++;
    } catch (err) {
      console.error(`[topic-suggestion-manager] saveSuggestions 失败 (${t.keyword}):`, err.message);
    }
  }

  return saved;
}

// ─── 查询 ─────────────────────────────────────────────────────────────────────

/**
 * 获取当前活跃的推荐列表（默认今日 pending）。
 *
 * @param {import('pg').Pool} dbPool
 * @param {{ date?: string, status?: string, limit?: number }} [opts]
 * @returns {Promise<Array>}
 */
export async function getActiveSuggestions(dbPool, opts = {}) {
  const { date, status = 'pending', limit = 10 } = opts;
  const targetDate = date || toDateString(new Date());

  const { rows } = await dbPool.query(
    `SELECT id, selected_date, keyword, content_type,
            title_candidates, hook, why_hot, priority_score,
            status, pipeline_task_id, reviewed_at, reviewed_by, created_at
     FROM topic_suggestions
     WHERE selected_date = $1
       AND status = $2
     ORDER BY priority_score DESC, created_at ASC
     LIMIT $3`,
    [targetDate, status, limit]
  );
  return rows;
}

// ─── 审批操作 ─────────────────────────────────────────────────────────────────

/**
 * Alex 批准一个选题 → 状态改为 approved → 创建 content-pipeline task。
 *
 * @param {import('pg').Pool} dbPool
 * @param {string} suggestionId
 * @param {string} [reviewer]
 * @returns {Promise<{ ok: boolean, pipeline_task_id?: string, error?: string }>}
 */
export async function approveSuggestion(dbPool, suggestionId, reviewer = 'alex') {
  const suggestion = await getSuggestionById(dbPool, suggestionId);
  if (!suggestion) return { ok: false, error: '选题不存在' };
  if (suggestion.status !== 'pending') {
    return { ok: false, error: `当前状态为 ${suggestion.status}，无法审批` };
  }

  const pipelineTaskId = await createPipelineTask(dbPool, suggestion);

  await dbPool.query(
    `UPDATE topic_suggestions
     SET status = 'approved', pipeline_task_id = $1, reviewed_at = NOW(), reviewed_by = $2, updated_at = NOW()
     WHERE id = $3`,
    [pipelineTaskId, reviewer, suggestionId]
  );

  return { ok: true, pipeline_task_id: pipelineTaskId };
}

/**
 * Alex 拒绝一个选题 → 状态改为 rejected。
 *
 * @param {import('pg').Pool} dbPool
 * @param {string} suggestionId
 * @param {string} [reviewer]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function rejectSuggestion(dbPool, suggestionId, reviewer = 'alex', reason = null) {
  const suggestion = await getSuggestionById(dbPool, suggestionId);
  if (!suggestion) return { ok: false, error: '选题不存在' };
  if (suggestion.status !== 'pending') {
    return { ok: false, error: `当前状态为 ${suggestion.status}，无法操作` };
  }

  await dbPool.query(
    `UPDATE topic_suggestions
     SET status = 'rejected', reviewed_at = NOW(), reviewed_by = $1,
         rejection_reason = $2, updated_at = NOW()
     WHERE id = $3`,
    [reviewer, reason || null, suggestionId]
  );

  return { ok: true };
}

// ─── 自动晋级 ─────────────────────────────────────────────────────────────────

/**
 * 自动晋级：将超过 AUTO_PROMOTE_AFTER_MINUTES 分钟未审核的 pending 选题晋级为 auto_promoted。
 * 由 tick.js 周期调用。
 *
 * @param {import('pg').Pool} dbPool
 * @returns {Promise<number>} 晋级数量
 */
export async function autoPromoteSuggestions(dbPool) {
  const { rows } = await dbPool.query(
    `SELECT id, keyword, content_type, title_candidates, hook, why_hot, priority_score, selected_date
     FROM topic_suggestions
     WHERE status = 'pending'
       AND created_at <= NOW() - INTERVAL '${AUTO_PROMOTE_AFTER_MINUTES} minutes'`
  );

  if (rows.length === 0) return 0;

  let promoted = 0;
  for (const suggestion of rows) {
    try {
      const pipelineTaskId = await createPipelineTask(dbPool, suggestion);
      await dbPool.query(
        `UPDATE topic_suggestions
         SET status = 'auto_promoted', pipeline_task_id = $1, reviewed_at = NOW(),
             reviewed_by = 'system', updated_at = NOW()
         WHERE id = $2`,
        [pipelineTaskId, suggestion.id]
      );
      promoted++;
      console.log(`[topic-suggestion-manager] 自动晋级: ${suggestion.keyword}`);
    } catch (err) {
      console.error(`[topic-suggestion-manager] 自动晋级失败 (${suggestion.keyword}):`, err.message);
    }
  }

  return promoted;
}

// ─── 内部工具 ─────────────────────────────────────────────────────────────────

async function getSuggestionById(dbPool, id) {
  const { rows } = await dbPool.query(
    `SELECT * FROM topic_suggestions WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

/**
 * 为选题创建 content-pipeline task，返回 task id。
 */
async function createPipelineTask(dbPool, suggestion) {
  const today = toDateString(new Date());
  const title = `[内容流水线] ${suggestion.keyword} ${today}`;
  const payload = JSON.stringify({
    pipeline_keyword: suggestion.keyword,
    content_type: suggestion.content_type || 'solo-company-case',
    title_candidates: suggestion.title_candidates || [],
    hook: suggestion.hook || '',
    why_hot: suggestion.why_hot || '',
    priority_score: suggestion.priority_score ?? 0.5,
    trigger_source: 'daily_topic_selection',
    selected_date: today,
    suggestion_id: suggestion.id,
  });

  const { rows } = await dbPool.query(
    `INSERT INTO tasks (
       title, task_type, status, priority,
       goal_id, created_by, payload, trigger_source, location, domain
     )
     VALUES (
       $1, 'content-pipeline', 'queued', 'P1',
       $2, 'cecelia-brain', $3, 'brain_auto', 'us', 'content'
     )
     RETURNING id`,
    [title, CONTENT_KR_GOAL_ID, payload]
  );

  return rows[0].id;
}

function toDateString(date) {
  return date.toISOString().split('T')[0];
}
