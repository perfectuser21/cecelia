import pool from '../db.js';
import { getQuarantinedTasks, getQuarantineStats, releaseTask, quarantineTask, QUARANTINE_REASONS, REVIEW_ACTIONS } from '../quarantine.js';

export function registerTaskQuarantineRoutes(router) {



// ==================== Blocked Tasks API ====================

/**
 * GET /api/brain/tasks/blocked
 * 查询当前所有 blocked 任务
 */
router.get('/tasks/blocked', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, title, status, task_type, priority,
             blocked_at, blocked_reason, blocked_until,
             updated_at
      FROM tasks
      WHERE status = 'blocked'
      ORDER BY blocked_until ASC NULLS LAST
    `);
    res.json({ success: true, tasks: result.rows, count: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get blocked tasks', details: err.message });
  }
});


/**
 * POST /api/brain/tasks/:taskId/unblock
 * 手动解除任务阻塞，释放回 queued
 */
router.post('/tasks/:taskId/unblock', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { unblockTask } = await import('../task-updater.js');
    const result = await unblockTask(taskId);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json({ success: true, task: result.task });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unblock task', details: err.message });
  }
});


// ==================== Quarantine API ====================

/**
 * GET /api/brain/quarantine
 * 获取隔离区中的任务列表
 */
router.get('/quarantine', async (req, res) => {
  try {
    const tasks = await getQuarantinedTasks();
    const stats = await getQuarantineStats();
    res.json({
      success: true,
      stats,
      tasks,
      reasons: QUARANTINE_REASONS,
      actions: REVIEW_ACTIONS
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get quarantine', details: err.message });
  }
});


/**
 * GET /api/brain/quarantine/stats
 * 获取隔离区统计
 */
router.get('/quarantine/stats', async (req, res) => {
  try {
    const stats = await getQuarantineStats();
    res.json({ success: true, ...stats });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get stats', details: err.message });
  }
});


/**
 * POST /api/brain/quarantine/:taskId/release
 * 释放任务从隔离区
 * Body: { action: "release"|"retry_once"|"cancel"|"modify", reason?: string, new_prd?: string }
 */
router.post('/quarantine/:taskId/release', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { action, reason, new_prd, reviewer } = req.body;

    if (!action || !REVIEW_ACTIONS[action.toUpperCase()]) {
      return res.status(400).json({
        error: 'Invalid action',
        valid_actions: Object.keys(REVIEW_ACTIONS)
      });
    }

    const result = await releaseTask(taskId, action, {
      reason,
      new_prd,
      reviewer: reviewer || 'api'
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to release task', details: err.message });
  }
});


/**
 * POST /api/brain/quarantine/:taskId
 * 手动隔离任务
 * Body: { reason?: string, details?: object }
 */
router.post('/quarantine/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { reason, details } = req.body;

    const result = await quarantineTask(
      taskId,
      reason || QUARANTINE_REASONS.MANUAL,
      details || { manual: true, reviewer: 'api' }
    );

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to quarantine task', details: err.message });
  }
});


/**
 * POST /api/brain/quarantine/release-all
 * 批量释放所有隔离任务（谨慎使用）
 * Body: { action: "release"|"cancel", confirm: true }
 */
router.post('/quarantine/release-all', async (req, res) => {
  try {
    const { action, confirm } = req.body;

    if (!confirm) {
      return res.status(400).json({ error: 'Must set confirm: true to release all' });
    }

    if (!action || !['release', 'cancel'].includes(action)) {
      return res.status(400).json({ error: 'action must be "release" or "cancel"' });
    }

    const tasks = await getQuarantinedTasks();
    const results = [];

    for (const task of tasks) {
      const result = await releaseTask(task.id, action, { reviewer: 'batch-api' });
      results.push({ task_id: task.id, ...result });
    }

    res.json({
      success: true,
      action,
      processed: results.length,
      results
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to release all', details: err.message });
  }
});
}
