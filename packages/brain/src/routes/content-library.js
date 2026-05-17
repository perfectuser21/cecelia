/**
 * content-library.js
 *
 * 内容库 API — 查看每日产出、提交人工审核、获取统计。
 *
 * GET  /api/brain/content-library            — 查询已完成 content-pipeline 列表
 * GET  /api/brain/content-library/stats      — 每日产出统计（最近7天），含 KR 达标情况
 * PATCH /api/brain/content-library/:id/review — 提交人工审核（approved/rejected/needs-revision）
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// KR 日均目标：≥3 条
const DAILY_TARGET = 3;

/**
 * GET /content-library
 * 查询已完成 content-pipeline 任务列表。
 * 支持 ?date=YYYY-MM-DD&review_status=pending_review|approved|rejected|needs-revision&limit=20
 */
router.get('/', async (req, res) => {
  try {
    const { date, review_status, limit = 20 } = req.query;
    const params = [];
    const conditions = [`task_type = 'content-pipeline'`, `status = 'completed'`];
    let paramIdx = 1;

    if (date) {
      conditions.push(`DATE(created_at AT TIME ZONE 'UTC') = $${paramIdx++}`);
      params.push(date);
    }

    if (review_status) {
      if (review_status === 'pending_review') {
        conditions.push(`(payload->>'review_status' IS NULL OR payload->>'review_status' = 'pending_review')`);
      } else {
        conditions.push(`payload->>'review_status' = $${paramIdx++}`);
        params.push(review_status);
      }
    }

    params.push(Math.min(parseInt(limit) || 20, 100));

    const { rows } = await pool.query(
      `SELECT id, title, payload, created_at
       FROM tasks
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${paramIdx}`,
      params
    );

    const data = rows.map(row => ({
      id: row.id,
      title: row.title,
      keyword: row.payload?.pipeline_keyword || '',
      content_type: row.payload?.content_type || '',
      selected_date: row.payload?.selected_date || row.created_at?.toISOString().slice(0, 10),
      created_at: row.created_at,
      review_status: row.payload?.review_status || 'pending_review',
      review_feedback: row.payload?.review_feedback || null,
      reviewed_at: row.payload?.reviewed_at || null,
      output_url: `/api/brain/pipelines/${row.id}/output`,
    }));

    res.json({ data, total: data.length });
  } catch (err) {
    console.error('[content-library] GET / 失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /content-library/stats
 * 最近7天每日产出统计，含 KR 达标情况。
 * 返回: { stats: [{date, total_completed, approved, rejected, pending_review}], kr_target, summary }
 */
router.get('/stats', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        DATE(created_at AT TIME ZONE 'UTC') AS date,
        COUNT(*)                                                                          AS total_completed,
        COUNT(*) FILTER (WHERE payload->>'review_status' = 'approved')                   AS approved,
        COUNT(*) FILTER (WHERE payload->>'review_status' = 'rejected')                   AS rejected,
        COUNT(*) FILTER (WHERE payload->>'review_status' = 'needs-revision')             AS needs_revision,
        COUNT(*) FILTER (WHERE payload->>'review_status' IS NULL
                             OR payload->>'review_status' = 'pending_review')            AS pending_review
      FROM tasks
      WHERE task_type = 'content-pipeline'
        AND status = 'completed'
        AND created_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(created_at AT TIME ZONE 'UTC')
      ORDER BY date DESC
    `);

    const stats = rows.map(r => ({
      date: r.date,
      total_completed: parseInt(r.total_completed),
      approved: parseInt(r.approved),
      rejected: parseInt(r.rejected),
      needs_revision: parseInt(r.needs_revision),
      pending_review: parseInt(r.pending_review),
      met_target: parseInt(r.total_completed) >= DAILY_TARGET,
    }));

    res.json({
      stats,
      kr_target: DAILY_TARGET,
      summary: {
        days_tracked: stats.length,
        days_met_target: stats.filter(r => r.met_target).length,
      },
    });
  } catch (err) {
    console.error('[content-library] GET /stats 失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /content-library/:id/review
 * 提交人工审核结果。
 * Body: { status: 'approved'|'rejected'|'needs-revision', feedback?: string }
 */
router.patch('/:id/review', async (req, res) => {
  const { id } = req.params;
  const { status, feedback } = req.body || {};

  const VALID_STATUSES = ['approved', 'rejected', 'needs-revision'];
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({
      error: `status 必须是 ${VALID_STATUSES.join('|')}`,
    });
  }

  try {
    const reviewPatch = JSON.stringify({
      review_status: status,
      review_feedback: feedback || null,
      reviewed_at: new Date().toISOString(),
    });

    const { rowCount, rows } = await pool.query(
      `UPDATE tasks
       SET payload = payload || $1::jsonb,
           updated_at = NOW()
       WHERE id = $2
         AND task_type = 'content-pipeline'
       RETURNING id, title, payload->>'review_status' AS review_status`,
      [reviewPatch, id]
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Pipeline 不存在或类型不是 content-pipeline' });
    }

    res.json({
      ok: true,
      id,
      review_status: rows[0].review_status,
      feedback: feedback || null,
    });
  } catch (err) {
    console.error('[content-library] PATCH /:id/review 失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
