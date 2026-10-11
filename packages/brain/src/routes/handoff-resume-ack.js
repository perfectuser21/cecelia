/**
 * routes/handoff-resume-ack.js — 有头续接「待续」销账（主理人 2026-10-11 决策）
 *
 * 挂在 /api/brain/handoffs/pending-resume 下，与只读的 routes/handoffs.js 分开（warroom 只读约束）。
 */
import { Router } from 'express';
import pool from '../db.js';

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/brain/handoffs/pending-resume/:taskId/ack  { resumed_by?, resumed_task_id? }
 *   新的有头会话接上后销「待续」：pending → resumed。只改 pending 的，重复 ack → 404。
 */
router.post('/:taskId/ack', async (req, res) => {
  const { taskId } = req.params;
  if (!UUID_RE.test(taskId)) return res.status(400).json({ error: 'invalid task id' });
  try {
    const resumedBy = String(req.body?.resumed_by || req.headers['x-session-id'] || 'headed-session').slice(0, 200);
    const resumedTaskId = req.body?.resumed_task_id && UUID_RE.test(String(req.body.resumed_task_id)) ? String(req.body.resumed_task_id) : null;
    const { rows, rowCount } = await pool.query(
      `UPDATE tasks
          SET result = jsonb_set(result, '{pending_resume}',
                (result->'pending_resume') || jsonb_build_object('status', 'resumed', 'resumed_at', NOW(), 'resumed_by', $2::text, 'resumed_task_id', $3::text)),
              updated_at = NOW()
        WHERE id = $1::uuid AND result->'pending_resume'->>'status' = 'pending'
        RETURNING id, result->'pending_resume' AS pending_resume`,
      [taskId, resumedBy, resumedTaskId]
    );
    if (!rowCount) return res.status(404).json({ error: 'no pending resume for task', task_id: taskId });
    res.json({ success: true, task_id: rows[0].id, pending_resume: rows[0].pending_resume });
  } catch (err) {
    console.error('[handoffs] POST ack error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
