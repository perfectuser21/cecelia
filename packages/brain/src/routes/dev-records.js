/**
 * Dev Records 路由 — 开发档案 API
 *
 * GET  /api/brain/dev-records       — 列表（支持 ?limit=&offset=&since=）
 * GET  /api/brain/dev-records/:id   — 详情
 * POST /api/brain/dev-records       — 创建（PR callback 调用）
 * PUT  /api/brain/dev-records/:id   — 更新（评分、review 结果）
 */

/* global console */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/** GET / — 列表 */
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const params = [limit, offset];
    let whereClause = '';

    if (req.query.since) {
      params.push(req.query.since);
      whereClause = `WHERE merged_at >= $${params.length}`;
    }

    const { rows } = await pool.query(
      `SELECT id, task_id, pr_title, pr_url, branch, merged_at,
              ci_results, code_review_result, arch_review_result,
              self_score, learning_ref, learning_summary, root_cause,
              created_at, updated_at
       FROM dev_records
       ${whereClause}
       ORDER BY merged_at DESC NULLS LAST, created_at DESC
       LIMIT $1 OFFSET $2`,
      params
    );

    const { rows: countRows } = await pool.query(
      `SELECT count(*) FROM dev_records ${whereClause}`,
      whereClause ? params.slice(2) : []
    );

    res.json({ success: true, data: rows, total: parseInt(countRows[0].count) });
  } catch (err) {
    console.error('[dev-records] GET / error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /:id — 详情 */
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM dev_records WHERE id = $1',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[dev-records] GET /:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST / — 创建（PR callback 或手动） */
router.post('/', async (req, res) => {
  try {
    const {
      task_id, pr_title, pr_url, branch, merged_at,
      prd_content, dod_items, ci_results,
      code_review_result, arch_review_result, self_score,
      learning_ref, learning_summary, root_cause
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO dev_records (
         task_id, pr_title, pr_url, branch, merged_at,
         prd_content, dod_items, ci_results,
         code_review_result, arch_review_result, self_score,
         learning_ref, learning_summary, root_cause
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        task_id || null, pr_title || null, pr_url || null,
        branch || null, merged_at || null,
        prd_content || null,
        dod_items ? JSON.stringify(dod_items) : null,
        ci_results ? JSON.stringify(ci_results) : null,
        code_review_result || null, arch_review_result || null,
        self_score || null, learning_ref || null,
        learning_summary || null, root_cause || null
      ]
    );

    res.status(201).json({ success: true, data: rows[0] || null });
  } catch (err) {
    console.error('[dev-records] POST / error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/** PUT /:id — 更新 */
router.put('/:id', async (req, res) => {
  try {
    const allowed = [
      'code_review_result', 'arch_review_result', 'self_score',
      'learning_summary', 'root_cause', 'dod_items', 'ci_results'
    ];
    const updates = [];
    const params = [req.params.id];

    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        params.push(req.body[field]);
        updates.push(`${field} = $${params.length}`);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: '无可更新字段' });
    }

    params.push(new Date().toISOString());
    updates.push(`updated_at = $${params.length}`);

    const { rows } = await pool.query(
      `UPDATE dev_records SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
      params
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[dev-records] PUT /:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
