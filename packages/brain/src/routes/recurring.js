/**
 * Brain API: Recurring Tasks CRUD
 *
 * GET    /api/brain/recurring-tasks        列出所有定时任务
 * POST   /api/brain/recurring-tasks        创建定时任务
 * PATCH  /api/brain/recurring-tasks/:id    更新定时任务
 * DELETE /api/brain/recurring-tasks/:id    删除定时任务
 */

import express from 'express';
import pool from '../db.js';

const router = express.Router();

// GET / — 列出所有定时任务
router.get('/', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, title, description, cron_expression, executor,
             is_active, recurrence_type, priority,
             last_run_at, next_run_at, last_run_status,
             notion_page_id, created_at
      FROM recurring_tasks
      ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[routes/recurring] GET / error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST / — 创建定时任务
router.post('/', async (req, res) => {
  const {
    title, description, cron_expression, executor = 'cecelia',
    is_active = true, recurrence_type = 'cron', priority = 'P1',
    goal_id, project_id, notion_page_id,
  } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'title 必填' });
  }

  try {
    const result = await pool.query(`
      INSERT INTO recurring_tasks (
        title, description, cron_expression, executor,
        is_active, recurrence_type, priority,
        goal_id, project_id, notion_page_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      title, description || '', cron_expression || null, executor,
      is_active, recurrence_type, priority,
      goal_id || null, project_id || null, notion_page_id || null,
    ]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[routes/recurring] POST / error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /:id — 更新定时任务
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const allowed = [
    'title', 'description', 'cron_expression', 'executor',
    'is_active', 'recurrence_type', 'priority',
    'goal_id', 'project_id', 'notion_page_id',
  ];
  const updates = [];
  const values  = [];
  let idx = 1;

  for (const key of allowed) {
    if (key in req.body) {
      updates.push(`${key} = $${idx++}`);
      values.push(req.body[key]);
    }
  }

  if (!updates.length) {
    return res.status(400).json({ error: '无可更新字段' });
  }

  values.push(id);

  try {
    const result = await pool.query(
      `UPDATE recurring_tasks SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: '未找到定时任务' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[routes/recurring] PATCH /:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id — 删除定时任务
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'DELETE FROM recurring_tasks WHERE id = $1 RETURNING id, title',
      [id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: '未找到定时任务' });
    }
    res.json({ deleted: result.rows[0] });
  } catch (err) {
    console.error('[routes/recurring] DELETE /:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
