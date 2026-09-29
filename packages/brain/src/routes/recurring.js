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
import { nextSlotAfter, validateSchedule, isValidScheduleExpression } from '../lib/recurring-schedule.js';

const router = express.Router();

// GET / — 列出所有定时任务
router.get('/', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, title, description, cron_expression, executor,
             is_active, recurrence_type, priority, task_type, template,
             last_run_at, next_run_at, last_run_status, skip_streak,
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
// next_run_at 不在这里算：留空，由定时引擎首轮写基线（只算下一个时间点，不补跑）。
router.post('/', async (req, res) => {
  const {
    title, description, cron_expression, executor = 'cecelia',
    is_active = true, recurrence_type = 'cron', priority = 'P1',
    goal_id, project_id, notion_page_id, template, task_type,
  } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'title 必填' });
  }
  const invalid = validateSchedule({ recurrence_type, cron_expression, template });
  if (invalid) {
    return res.status(400).json({ error: invalid });
  }

  try {
    const result = await pool.query(`
      INSERT INTO recurring_tasks (
        title, description, cron_expression, executor,
        is_active, recurrence_type, priority,
        goal_id, project_id, notion_page_id,
        template, task_type
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
      RETURNING *
    `, [
      title, description || '', cron_expression || null, executor,
      is_active, recurrence_type, priority,
      goal_id || null, project_id || null, notion_page_id || null,
      JSON.stringify(template || {}), task_type || template?.task_type || 'dev',
    ]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[routes/recurring] POST / error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /:id — 更新定时任务
// is_active false→true、或改 cron_expression / recurrence_type / template.timezone 时重建基线：
// next_run_at = 现在之后的下一个时间点，绝不补跑停用期间 / 旧 cron 的时间点。
const PATCHABLE = [
  'title', 'description', 'cron_expression', 'executor',
  'is_active', 'recurrence_type', 'priority',
  'goal_id', 'project_id', 'notion_page_id',
  'template', 'task_type',
];
const OLD_COLUMNS = ['is_active', 'cron_expression', 'recurrence_type'];

function stripOld(row) {
  const out = { ...row };
  for (const key of Object.keys(out)) if (key.startsWith('_old_')) delete out[key];
  return out;
}

function needsRebaseline(body, row) {
  if (row.is_active === false) return false;
  if (body.is_active === true && row._old_is_active === false) return true;
  if ('cron_expression' in body && body.cron_expression !== row._old_cron_expression) return true;
  if ('recurrence_type' in body && row._old_recurrence_type !== undefined && body.recurrence_type !== row._old_recurrence_type) return true;
  if ('template' in body && row._old_timezone !== undefined && (body.template?.timezone ?? null) !== (row._old_timezone ?? null)) return true;
  return false;
}

router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const updates = [];
  const values = [];
  let idx = 1;

  for (const key of PATCHABLE) {
    if (key in body) {
      updates.push(key === 'template' ? `template = $${idx++}::jsonb` : `${key} = $${idx++}`);
      values.push(key === 'template' ? JSON.stringify(body.template ?? {}) : body[key]);
    }
  }

  if (!updates.length) {
    return res.status(400).json({ error: '无可更新字段' });
  }
  if ('cron_expression' in body && body.cron_expression != null && !isValidScheduleExpression(body.cron_expression)) {
    return res.status(400).json({ error: `cron_expression 非法: ${body.cron_expression}` });
  }
  if ('template' in body || 'recurrence_type' in body) {
    const invalid = validateSchedule({
      recurrence_type: body.recurrence_type,
      cron_expression: 'recurrence_type' in body ? body.cron_expression : undefined,
      template: body.template,
    });
    if (invalid) return res.status(400).json({ error: invalid });
  }

  values.push(id);
  const oldSelect = OLD_COLUMNS.map((c) => `old.${c} AS _old_${c}`).join(', ');

  try {
    // CTE 取改前值（同一语句、行锁内），用于判定是否要重建基线
    const result = await pool.query(
      `WITH old AS (SELECT id, ${OLD_COLUMNS.join(', ')}, template->>'timezone' AS timezone
                      FROM recurring_tasks WHERE id = $${idx} FOR UPDATE)
       UPDATE recurring_tasks r SET ${updates.join(', ')}
         FROM old WHERE r.id = old.id
       RETURNING r.*, ${oldSelect}, old.timezone AS _old_timezone`,
      values
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: '未找到定时任务' });
    }
    const row = result.rows[0];
    if (!needsRebaseline(body, row)) {
      return res.json(stripOld(row));
    }
    const next = nextSlotAfter(row, new Date());
    const rebased = await pool.query(
      'UPDATE recurring_tasks SET next_run_at = $1 WHERE id = $2 RETURNING *',
      [next ? next.toISOString() : null, id]
    );
    res.json(stripOld(rebased.rows[0] || { ...row, next_run_at: next ? next.toISOString() : null }));
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
