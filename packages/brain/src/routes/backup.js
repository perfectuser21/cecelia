/**
 * routes/backup.js — DB 备份手动触发接口
 *
 * POST /api/brain/backup/trigger-now
 *   body: { force?: boolean }
 *   触发每日备份调度（支持 force 跳过时间窗口检查）
 */
import { Router } from 'express';
import pool from '../db.js';
import { scheduleDailyBackup } from '../daily-backup-scheduler.js';

const router = Router();

/**
 * POST /trigger-now
 * 手动触发 trigger_backup 任务（支持 force=true 跳过时间窗口）
 */
router.post('/trigger-now', async (req, res) => {
  const force = req.body?.force === true;
  try {
    const result = await scheduleDailyBackup(pool, { force });
    res.json({
      ok: true,
      triggered: result.triggered,
      alreadyDone: result.alreadyDone,
      inWindow: result.inWindow,
      taskId: result.taskId ?? null,
      error: result.error ?? null,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
