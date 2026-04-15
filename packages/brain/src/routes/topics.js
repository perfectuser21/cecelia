import { Router } from 'express';
import pool from '../db.js';
import {
  getActiveSuggestions,
  approveSuggestion,
  rejectSuggestion,
  saveSuggestions,
} from '../topic-suggestion-manager.js';
import { generateTopics } from '../topic-selector.js';

const router = Router();

/**
 * GET /api/brain/topics
 * 查询 topic_selection_log 记录
 * 默认返回今日（WHERE selected_date = CURRENT_DATE）
 * 支持 ?date=YYYY-MM-DD 参数过滤指定日期
 */
router.get('/', async (req, res) => {
  try {
    const { date } = req.query;

    let queryText;
    let params;

    if (date) {
      queryText = `
        SELECT id, selected_date, keyword, content_type,
               title_candidates, hook, why_hot, priority_score, created_at
        FROM topic_selection_log
        WHERE selected_date = $1
        ORDER BY priority_score DESC, created_at DESC
      `;
      params = [date];
    } else {
      queryText = `
        SELECT id, selected_date, keyword, content_type,
               title_candidates, hook, why_hot, priority_score, created_at
        FROM topic_selection_log
        WHERE selected_date = CURRENT_DATE
        ORDER BY priority_score DESC, created_at DESC
      `;
      params = [];
    }

    const result = await pool.query(queryText, params);
    const selectedDate = date || new Date().toISOString().slice(0, 10);

    res.json({
      data: result.rows,
      date: selectedDate,
      total: result.rows.length,
    });
  } catch (err) {
    console.error('[topics-route] 查询失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/topics/suggestions
 * 获取选题推荐队列（默认今日 pending）
 * 支持 ?date=YYYY-MM-DD&status=pending|approved|rejected|auto_promoted
 */
router.get('/suggestions', async (req, res) => {
  try {
    const { date, status = 'pending' } = req.query;
    const data = await getActiveSuggestions(pool, { date, status });
    res.json({ data, total: data.length, status });
  } catch (err) {
    console.error('[topics-route] GET /suggestions 失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/topics/suggestions/:id/approve
 * Alex 批准选题 → 创建 content-pipeline task
 * Body: { reviewer?: string }
 */
router.post('/suggestions/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const reviewer = req.body?.reviewer || 'alex';
    const result = await approveSuggestion(pool, id, reviewer);
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }
    res.json({ ok: true, pipeline_task_id: result.pipeline_task_id });
  } catch (err) {
    console.error('[topics-route] POST /suggestions/:id/approve 失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/topics/suggestions/:id/reject
 * Alex 拒绝选题
 * Body: { reviewer?: string, rejection_reason?: string }
 */
router.post('/suggestions/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const reviewer = req.body?.reviewer || 'alex';
    const reason = req.body?.rejection_reason || null;
    const result = await rejectSuggestion(pool, id, reviewer, reason);
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[topics-route] POST /suggestions/:id/reject 失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/topics/stats
 * 选题决策统计：返回近 N 日的建议数、审核数、通过率。
 * 支持 ?days=7（默认 7 天）
 */
router.get('/stats', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 7, 90);
    const { rows } = await pool.query(
      `SELECT
         COUNT(*)                                           AS total,
         COUNT(*) FILTER (WHERE status = 'approved')       AS approved,
         COUNT(*) FILTER (WHERE status = 'rejected')       AS rejected,
         COUNT(*) FILTER (WHERE status = 'auto_promoted')  AS auto_promoted,
         COUNT(*) FILTER (WHERE status = 'pending')        AS pending,
         COUNT(*) FILTER (WHERE status IN ('approved','rejected','auto_promoted')) AS reviewed
       FROM topic_suggestions
       WHERE selected_date >= CURRENT_DATE - ($1 - 1) * INTERVAL '1 day'`,
      [days]
    );
    const row = rows[0];
    const total = Number(row.total);
    const approved = Number(row.approved);
    const rejected = Number(row.rejected);
    const auto_promoted = Number(row.auto_promoted);
    const reviewed = Number(row.reviewed);
    // 通过率 = 人工 approved / (approved + rejected)，不计 auto_promoted
    const human_reviewed = approved + rejected;
    const approval_rate = human_reviewed > 0
      ? Math.round((approved / human_reviewed) * 100) / 100
      : null;

    res.json({
      days,
      total,
      approved,
      rejected,
      auto_promoted,
      pending: Number(row.pending),
      reviewed,
      approval_rate,
      target_approval_rate: 0.7,
      meets_target: approval_rate !== null ? approval_rate >= 0.7 : null,
    });
  } catch (err) {
    console.error('[topics-route] GET /stats 失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/topics/generate
 * 手动触发选题生成（调试/测试用，不受每日触发窗口限制）
 * 生成选题后保存为 pending 推荐，返回保存数量
 * Body: { date?: "YYYY-MM-DD" }
 */
router.post('/generate', async (req, res) => {
  try {
    const today = req.body?.date || new Date().toISOString().slice(0, 10);
    const topics = await generateTopics(pool);
    const saved = await saveSuggestions(pool, topics, today);
    res.json({ ok: true, triggered: saved, total_generated: topics.length, date: today });
  } catch (err) {
    console.error('[topics-route] POST /generate 失败:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/brain/topics/analytics
 * 选题决策闭环通过率统计
 * 支持 ?days=7（默认 7 天）查询近 N 日的审核数据
 *
 * 返回：
 *   { days, total, approved, rejected, auto_promoted, pending, pass_rate }
 *   pass_rate = (approved + auto_promoted) / total × 100，精确到 1 位小数
 */
router.get('/analytics', async (req, res) => {
  try {
    const days = Math.max(1, Math.min(90, parseInt(req.query.days || '7', 10)));
    const { rows } = await pool.query(
      `SELECT
         status,
         COUNT(*) AS cnt
       FROM topic_suggestions
       WHERE created_at >= NOW() - INTERVAL '${days} days'
       GROUP BY status`
    );

    const countMap = { approved: 0, rejected: 0, auto_promoted: 0, pending: 0 };
    for (const row of rows) {
      if (row.status in countMap) {
        countMap[row.status] = parseInt(row.cnt, 10);
      }
    }
    const total = Object.values(countMap).reduce((s, v) => s + v, 0);
    const passCount = countMap.approved + countMap.auto_promoted;
    const reviewedCount = passCount + countMap.rejected;
    const pass_rate = reviewedCount > 0
      ? Math.round((passCount / reviewedCount) * 1000) / 10
      : null;

    res.json({
      days,
      total,
      approved: countMap.approved,
      rejected: countMap.rejected,
      auto_promoted: countMap.auto_promoted,
      pending: countMap.pending,
      pass_rate,
    });
  } catch (err) {
    console.error('[topics-route] GET /analytics 失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 以下为主理人选题池 v1 新增路由（topics 表）
// 与上方 topic_suggestions / topic_selection_log 路由并列但独立
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/brain/topics/rhythm
 * 查询每日触发上限配置
 */
router.get('/rhythm', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT daily_limit, updated_at FROM topics_rhythm_config ORDER BY id LIMIT 1`
    );
    res.json({ daily_limit: rows[0]?.daily_limit ?? 1, updated_at: rows[0]?.updated_at ?? null });
  } catch (err) {
    console.error('[topics] GET /rhythm error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/brain/topics/rhythm
 * Body: { daily_limit: number }
 */
router.patch('/rhythm', async (req, res) => {
  const { daily_limit } = req.body || {};
  if (typeof daily_limit !== 'number' || daily_limit < 0 || daily_limit > 50) {
    return res.status(400).json({ error: 'daily_limit 必须是 0-50 的整数' });
  }
  try {
    await pool.query(
      `UPDATE topics_rhythm_config SET daily_limit = $1, updated_at = NOW()`,
      [Math.floor(daily_limit)]
    );
    res.json({ ok: true, daily_limit: Math.floor(daily_limit) });
  } catch (err) {
    console.error('[topics] PATCH /rhythm error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/topics/pool
 * 主理人选题池列表
 * Query: status?, limit=20, offset=0
 */
router.get('/pool', async (req, res) => {
  const { status, limit = '20', offset = '0' } = req.query;
  const lim = Math.min(parseInt(limit, 10) || 20, 100);
  const off = parseInt(offset, 10) || 0;

  try {
    const whereParts = [];
    const params = [];

    if (status) {
      params.push(status);
      whereParts.push(`status = $${params.length}`);
    }

    const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM topics ${where}`,
      params
    );
    const total = countResult.rows[0]?.total ?? 0;

    params.push(lim, off);
    const { rows } = await pool.query(
      `SELECT id, title, angle, priority, status, target_platforms, scheduled_date,
              pipeline_task_id, created_at, updated_at
       FROM topics
       ${where}
       ORDER BY priority DESC, created_at ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ topics: rows, total, limit: lim, offset: off });
  } catch (err) {
    console.error('[topics] GET /pool error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/topics/pool
 * Body: { title, angle?, priority?, status?, target_platforms?, scheduled_date? }
 */
router.post('/pool', async (req, res) => {
  const {
    title,
    angle = null,
    priority = 50,
    status = 'draft',
    target_platforms = [],
    scheduled_date = null,
  } = req.body || {};

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title 必填' });
  }

  const validStatuses = ['draft', '已通过', '已发布', '已废弃'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `status 必须是: ${validStatuses.join(', ')}` });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO topics (title, angle, priority, status, target_platforms, scheduled_date)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [title.trim(), angle, priority, status, JSON.stringify(target_platforms), scheduled_date]
    );
    res.status(201).json({ ok: true, topic: rows[0] });
  } catch (err) {
    console.error('[topics] POST /pool error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/brain/topics/pool/:id
 * Body: 任意可更新字段
 */
router.patch('/pool/:id', async (req, res) => {
  const { id } = req.params;
  const {
    title, angle, priority, status, target_platforms, scheduled_date, pipeline_task_id
  } = req.body || {};

  const validStatuses = ['draft', '已通过', '已发布', '已废弃'];
  if (status !== undefined && !validStatuses.includes(status)) {
    return res.status(400).json({ error: `status 必须是: ${validStatuses.join(', ')}` });
  }

  const setClauses = [];
  const params = [];

  if (title !== undefined) {
    params.push(title.trim());
    setClauses.push(`title = $${params.length}`);
  }
  if (angle !== undefined) {
    params.push(angle);
    setClauses.push(`angle = $${params.length}`);
  }
  if (priority !== undefined) {
    params.push(priority);
    setClauses.push(`priority = $${params.length}`);
  }
  if (status !== undefined) {
    params.push(status);
    setClauses.push(`status = $${params.length}`);
  }
  if (target_platforms !== undefined) {
    params.push(JSON.stringify(target_platforms));
    setClauses.push(`target_platforms = $${params.length}`);
  }
  if (scheduled_date !== undefined) {
    params.push(scheduled_date);
    setClauses.push(`scheduled_date = $${params.length}`);
  }
  if (pipeline_task_id !== undefined) {
    params.push(pipeline_task_id);
    setClauses.push(`pipeline_task_id = $${params.length}`);
  }

  if (setClauses.length === 0) {
    return res.status(400).json({ error: '没有可更新的字段' });
  }

  setClauses.push(`updated_at = NOW()`);
  params.push(id);

  try {
    const { rows } = await pool.query(
      `UPDATE topics SET ${setClauses.join(', ')}
       WHERE id = $${params.length}
       RETURNING *`,
      params
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'topic 不存在' });
    }
    res.json({ ok: true, topic: rows[0] });
  } catch (err) {
    console.error('[topics] PATCH /pool/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/brain/topics/pool/:id
 */
router.delete('/pool/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query(`DELETE FROM topics WHERE id = $1`, [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'topic 不存在' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[topics] DELETE /pool/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
