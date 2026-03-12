/**
 * Task Goals route
 *
 * GET /              — 列出所有目标（支持 type, status, parent_id, area_id, limit, offset 过滤）
 * GET /audit         — KR 进度诚实化审计：stated_progress vs actual_progress（基于 initiative 完成率）
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

// GET /goals/audit — KR 进度诚实化审计
// 返回每个 KR 的 stated_progress（DB 存储值）vs actual_progress（基于 initiative 完成率）
router.get('/audit', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        g.id,
        g.title,
        g.type,
        g.status,
        g.progress AS stated_progress,
        COALESCE(
          (SELECT COUNT(*)
           FROM projects p
           WHERE p.kr_id = g.id AND p.type = 'initiative')
          +
          (SELECT COUNT(*)
           FROM projects p2
           JOIN projects p ON p.id = p2.parent_id
           WHERE p.kr_id = g.id AND p2.type = 'initiative'),
          0
        ) AS initiative_total,
        COALESCE(
          (SELECT COUNT(*)
           FROM projects p
           WHERE p.kr_id = g.id AND p.type = 'initiative' AND p.status = 'completed')
          +
          (SELECT COUNT(*)
           FROM projects p2
           JOIN projects p ON p.id = p2.parent_id
           WHERE p.kr_id = g.id AND p2.type = 'initiative' AND p2.status = 'completed'),
          0
        ) AS initiative_done
      FROM goals g
      WHERE g.type IN ('area_kr', 'global_kr', 'area_okr')
      ORDER BY g.progress DESC
    `);

    const result = rows.map(row => {
      const total = parseInt(row.initiative_total, 10);
      const done = parseInt(row.initiative_done, 10);
      const actual_progress = total > 0 ? Math.round((done / total) * 100) : null;
      const stated = parseInt(row.stated_progress, 10);
      const gap = actual_progress !== null ? stated - actual_progress : null;
      return {
        id: row.id,
        title: row.title,
        type: row.type,
        status: row.status,
        stated_progress: stated,
        actual_progress,
        initiative_total: total,
        initiative_done: done,
        gap,
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to audit goals', details: err.message });
  }
});

// POST /goals/audit/apply — 将虚标 KR progress 更正为实际值
// 仅修正 gap > threshold（默认 20）的 KR，写入 memory_stream 记录修正事件
router.post('/audit/apply', async (req, res) => {
  const threshold = parseInt(req.query.threshold || '20', 10);

  try {
    // 1. 获取审计数据（复用同一 SQL 逻辑）
    const { rows } = await pool.query(`
      SELECT
        g.id,
        g.title,
        g.progress AS stated_progress,
        COALESCE(
          (SELECT COUNT(*)
           FROM projects p
           WHERE p.kr_id = g.id AND p.type = 'initiative')
          +
          (SELECT COUNT(*)
           FROM projects p2
           JOIN projects p ON p.id = p2.parent_id
           WHERE p.kr_id = g.id AND p2.type = 'initiative'),
          0
        ) AS initiative_total,
        COALESCE(
          (SELECT COUNT(*)
           FROM projects p
           WHERE p.kr_id = g.id AND p.type = 'initiative' AND p.status = 'completed')
          +
          (SELECT COUNT(*)
           FROM projects p2
           JOIN projects p ON p.id = p2.parent_id
           WHERE p.kr_id = g.id AND p2.type = 'initiative' AND p2.status = 'completed'),
          0
        ) AS initiative_done
      FROM goals g
      WHERE g.type IN ('area_kr', 'global_kr', 'area_okr')
    `);

    // 2. 筛选需要修正的 KR（actual_progress 已知 且 gap > threshold）
    const corrections = [];
    for (const row of rows) {
      const total = parseInt(row.initiative_total, 10);
      const done = parseInt(row.initiative_done, 10);
      if (total === 0) continue;
      const actual = Math.round((done / total) * 100);
      const stated = parseInt(row.stated_progress, 10);
      const gap = stated - actual;
      if (gap > threshold) {
        corrections.push({
          id: row.id,
          title: row.title,
          old_progress: stated,
          new_progress: actual,
          gap,
          initiative_total: total,
          initiative_done: done,
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
