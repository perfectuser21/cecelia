/**
 * Task Goals route
 *
 * GET /              — 列出所有目标（支持 type, status, parent_id, area_id, limit, offset 过滤）
 * GET /audit         — KR 进度审计：比较 stated_progress vs initiative 实际完成率
 * GET /:id           — 获取单个 goal
 * PATCH /:id         — 更新 goal 字段（title, status, priority, progress, weight, area_id, custom_props）
 * POST /audit/apply  — 将虚标 KR progress 更正为实际值，写入 memory_stream
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// GET /goals — 列出目标（支持多种过滤）
router.get('/', async (req, res) => {
  try {
    const { type, status, parent_id, area_id, limit, offset } = req.query;

    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (type) {
      conditions.push(`type = $${paramIndex++}`);
      params.push(type);
    }
    if (status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(status);
    }
    if (parent_id) {
      conditions.push(`parent_id = $${paramIndex++}`);
      params.push(parent_id);
    }
    if (area_id) {
      conditions.push(`area_id = $${paramIndex++}`);
      params.push(area_id);
    }

    let query = 'SELECT * FROM goals';
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY created_at DESC';

    if (limit) {
      query += ` LIMIT $${paramIndex++}`;
      params.push(parseInt(limit, 10));
    }
    if (offset) {
      query += ` OFFSET $${paramIndex++}`;
      params.push(parseInt(offset, 10));
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list goals', details: err.message });
  }
});

// GET /goals/audit — KR 进度审计
router.get('/audit', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        g.id,
        g.title,
        g.type,
        g.status,
        g.progress AS stated_progress,
        COUNT(p.id) AS total_initiatives,
        COUNT(p.id) FILTER (WHERE p.status = 'completed') AS completed_initiatives,
        CASE
          WHEN COUNT(p.id) = 0 THEN NULL
          ELSE ROUND(COUNT(p.id) FILTER (WHERE p.status = 'completed') * 100.0 / COUNT(p.id))
        END AS actual_progress
      FROM goals g
      LEFT JOIN projects p ON p.kr_id = g.id AND p.type = 'initiative'
      WHERE g.type IN ('area_okr', 'kr')
      GROUP BY g.id, g.title, g.type, g.status, g.progress
      ORDER BY g.progress DESC, g.title
    `);

    const rows = result.rows.map(r => ({
      id: r.id,
      title: r.title,
      type: r.type,
      status: r.status,
      stated_progress: r.stated_progress,
      actual_progress: r.actual_progress !== null ? Number(r.actual_progress) : null,
      total_initiatives: Number(r.total_initiatives),
      completed_initiatives: Number(r.completed_initiatives),
      discrepancy: r.actual_progress !== null
        ? r.stated_progress - Number(r.actual_progress)
        : null,
    }));

    const summary = {
      total_goals: rows.length,
      overstated: rows.filter(r => r.discrepancy !== null && r.discrepancy > 10).length,
      no_initiatives: rows.filter(r => r.total_initiatives === 0).length,
      accurate: rows.filter(r => r.discrepancy !== null && Math.abs(r.discrepancy) <= 10).length,
    };

    res.json({ summary, goals: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to audit goals', details: err.message });
  }
});

// POST /goals/audit/apply — 将虚标 KR progress 更正为实际值
// 仅修正 discrepancy > threshold（默认 20）的 KR，写入 memory_stream 记录修正事件
router.post('/audit/apply', async (req, res) => {
  const threshold = parseInt(req.query.threshold || '20', 10);

  try {
    // 1. 获取审计数据
    const { rows } = await pool.query(`
      SELECT
        g.id,
        g.title,
        g.progress AS stated_progress,
        COUNT(p.id) AS total_initiatives,
        COUNT(p.id) FILTER (WHERE p.status = 'completed') AS completed_initiatives,
        CASE
          WHEN COUNT(p.id) = 0 THEN NULL
          ELSE ROUND(COUNT(p.id) FILTER (WHERE p.status = 'completed') * 100.0 / COUNT(p.id))
        END AS actual_progress
      FROM goals g
      LEFT JOIN projects p ON p.kr_id = g.id AND p.type = 'initiative'
      WHERE g.type IN ('area_okr', 'kr', 'area_kr', 'global_kr')
      GROUP BY g.id, g.title, g.progress
    `);

    // 2. 筛选需要修正的 KR（actual_progress 已知 且 discrepancy > threshold）
    const corrections = [];
    for (const row of rows) {
      if (row.actual_progress === null) continue;
      const stated = parseInt(row.stated_progress, 10);
      const actual = Number(row.actual_progress);
      const discrepancy = stated - actual;
      if (discrepancy > threshold) {
        corrections.push({
          id: row.id,
          title: row.title,
          old_progress: stated,
          new_progress: actual,
          gap: discrepancy,
          initiative_total: Number(row.total_initiatives),
          initiative_done: Number(row.completed_initiatives),
        });
      }
    }

    if (corrections.length === 0) {
      return res.json({ applied: 0, corrections: [], message: 'No corrections needed' });
    }

    // 3. 批量更新 goals.progress
    for (const c of corrections) {
      await pool.query(
        'UPDATE goals SET progress = $1, updated_at = NOW() WHERE id = $2',
        [c.new_progress, c.id]
      );
    }

    // 4. 写入 memory_stream 记录修正事件
    const eventContent = JSON.stringify({
      event: 'kr_progress_correction',
      applied_at: new Date().toISOString(),
      threshold,
      corrections,
    });

    await pool.query(
      `INSERT INTO memory_stream (content, importance, memory_type, source_type, expires_at)
       VALUES ($1, 7, 'long', 'kr_audit', NOW() + INTERVAL '180 days')`,
      [eventContent]
    );

    res.json({
      applied: corrections.length,
      corrections,
      message: `Corrected ${corrections.length} KRs, event recorded in memory_stream`,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to apply audit corrections', details: err.message });
  }
});

// GET /goals/:id — 获取单个 goal
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM goals WHERE id = $1', [req.params.id]);
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Goal not found', id: req.params.id });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get goal', details: err.message });
  }
});

// PATCH /goals/:id — 更新 goal 字段
router.patch('/:id', async (req, res) => {
  try {
    const { title, status, priority, progress, weight, area_id, custom_props } = req.body;

    const setClauses = [];
    const params = [];
    let paramIndex = 1;

    if (title !== undefined) {
      setClauses.push(`title = $${paramIndex++}`);
      params.push(title);
    }
    if (status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`);
      params.push(status);
    }
    if (priority !== undefined) {
      setClauses.push(`priority = $${paramIndex++}`);
      params.push(priority);
    }
    if (progress !== undefined) {
      setClauses.push(`progress = $${paramIndex++}`);
      params.push(progress);
    }
    if (weight !== undefined) {
      setClauses.push(`weight = $${paramIndex++}`);
      params.push(weight);
    }
    if (area_id !== undefined) {
      setClauses.push(`area_id = $${paramIndex++}`);
      params.push(area_id);
    }
    if (custom_props !== undefined) {
      setClauses.push(`custom_props = custom_props || $${paramIndex++}::jsonb`);
      params.push(JSON.stringify(custom_props));
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    setClauses.push(`updated_at = NOW()`);
    params.push(req.params.id);

    const result = await pool.query(
      `UPDATE goals SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      params
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Goal not found', id: req.params.id });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update goal', details: err.message });
  }
});

export default router;
