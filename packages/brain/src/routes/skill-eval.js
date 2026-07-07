/**
 * routes/skill-eval.js — Skill Eval 路由
 *
 * POST /api/brain/skill-eval/upload
 * GET  /api/brain/skill-eval/status/:task_id
 */

import { Router } from 'express';
import pool from '../db.js';
import { validateToken, validateZipMiddleware, checkBackpressure, handleUpload } from '../skill-eval/upload-handler.js';

const router = Router();

// multer — 内存模式，文件存在 req.file.buffer
let multerUpload;
try {
  const multer = (await import('multer')).default;
  multerUpload = multer({ storage: multer.memoryStorage() }).single('file');
} catch (_err) {
  // multer not installed — provide stub for tests
  multerUpload = (req, _res, next) => next();
}

/**
 * POST /upload
 * 接收技能 zip，验证，去重，入队
 */
router.post('/upload',
  validateToken,
  multerUpload,
  validateZipMiddleware,
  checkBackpressure,
  handleUpload
);

/**
 * GET /status/:task_id
 * 查询任务状态
 */
router.get('/status/:task_id', async (req, res) => {
  const { task_id } = req.params;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(task_id)) {
    return res.status(400).json({ error: 'invalid_task_id' });
  }

  try {
    const result = await pool.query(
      `SELECT t.id, t.status, t.created_at,
              (t.result->>'report_url') AS report_url,
              (SELECT COUNT(*)::int FROM tasks
               WHERE task_type = 'skill_eval'
                 AND status = 'pending'
                 AND created_at < t.created_at) AS queue_position
       FROM tasks t
       WHERE t.id = $1 AND t.task_type = 'skill_eval'`,
      [task_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'not_found' });
    }

    const task = result.rows[0];
    return res.json({
      task_id: task.id,
      status: task.status,
      queue_position: task.status === 'pending' ? task.queue_position : null,
      report_url: task.report_url || null,
      created_at: task.created_at,
    });
  } catch (err) {
    return res.status(500).json({ error: 'db_error', detail: err.message });
  }
});

export default router;
