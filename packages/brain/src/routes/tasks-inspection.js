import pool from '../db.js';
import { blockTask } from '../task-updater.js';

export function registerTaskInspectionRoutes(router) {


// ==================== Execution Logs API ====================

/**
 * GET /tasks/:taskId/logs
 * 获取任务执行日志
 */
router.get('/tasks/:taskId/logs', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { offset = 0, limit = 1000 } = req.query;

    // 1. Get task metadata to find log file path
    const taskResult = await pool.query(
      'SELECT id, title, metadata FROM tasks WHERE id = $1',
      [taskId]
    );

    if (taskResult.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const task = taskResult.rows[0];
    const metadata = task.metadata || {};
    const logFile = metadata.log_file;

    if (!logFile) {
      return res.json({
        task_id: taskId,
        task_title: task.title,
        logs: [],
        message: 'No log file associated with this task'
      });
    }

    // 2. Read log file
    const fs = await import('fs/promises');
    const _path = await import('path');

    try {
      const logContent = await fs.readFile(logFile, 'utf-8');
      const lines = logContent.split('\n');

      // Apply pagination
      const start = parseInt(offset);
      const end = start + parseInt(limit);
      const paginatedLines = lines.slice(start, end);

      res.json({
        task_id: taskId,
        task_title: task.title,
        log_file: logFile,
        total_lines: lines.length,
        offset: start,
        limit: parseInt(limit),
        logs: paginatedLines
      });
    } catch (fileErr) {
      if (fileErr.code === 'ENOENT') {
        return res.json({
          task_id: taskId,
          task_title: task.title,
          log_file: logFile,
          logs: [],
          message: 'Log file not found on disk'
        });
      }
      throw fileErr;
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to get task logs', details: err.message });
  }
});


/**
 * GET /tasks/:taskId/checkpoints
 * 获取任务的 checkpoint 信息
 */
router.get('/tasks/:taskId/checkpoints', async (req, res) => {
  try {
    const { taskId } = req.params;

    // Get task with metadata
    const taskResult = await pool.query(
      'SELECT id, title, status, metadata, created_at, started_at, completed_at FROM tasks WHERE id = $1',
      [taskId]
    );

    if (taskResult.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const task = taskResult.rows[0];
    const metadata = task.metadata || {};

    // Extract checkpoint-related information
    const checkpoints = [];

    // Add task lifecycle checkpoints
    if (task.created_at) {
      checkpoints.push({
        timestamp: task.created_at,
        event: 'task_created',
        status: 'queued'
      });
    }

    if (task.started_at) {
      checkpoints.push({
        timestamp: task.started_at,
        event: 'task_started',
        status: 'running'
      });
    }

    if (task.completed_at) {
      checkpoints.push({
        timestamp: task.completed_at,
        event: 'task_completed',
        status: task.status
      });
    }

    // Add any additional checkpoints from metadata
    if (metadata.checkpoints && Array.isArray(metadata.checkpoints)) {
      checkpoints.push(...metadata.checkpoints);
    }

    // Sort by timestamp
    checkpoints.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    res.json({
      task_id: taskId,
      task_title: task.title,
      current_status: task.status,
      checkpoints
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get task checkpoints', details: err.message });
  }
});



/**
 * GET /api/brain/tasks/:id/ci-diagnosis
 * 返回任务最近一次 CI 失败的自动诊断结果
 */
router.get('/tasks/:id/ci-diagnosis', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT metadata->>'ci_diagnosis' AS ci_diagnosis FROM tasks WHERE id = $1`,
      [id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'task not found' });
    }
    const raw = result.rows[0].ci_diagnosis;
    if (!raw) {
      return res.status(404).json({ error: 'no CI diagnosis available for this task' });
    }
    return res.json(JSON.parse(raw));
  } catch (err) {
    console.error('[GET /tasks/:id/ci-diagnosis] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});


/**
 * POST /api/brain/tasks/:id/block
 * 手动阻塞任务（临时暂停调度，等待条件就绪后自动或手动恢复）
 * 请求体：{ reason, detail, until }
 */
router.post('/tasks/:id/block', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason = 'manual', detail = null, until = null } = req.body || {};

    const { blockTask } = await import('../task-updater.js');
    const result = await blockTask(id, { reason, detail, until: until ? new Date(until) : null });

    if (!result.success) {
      // owner_decision 缺协议是调用方错误（400 + 缺项清单），不是「任务不存在」
      if (result.code === 'owner_decision_protocol_violation') {
        return res.status(400).json({
          error: result.code, reason_code: result.code, message: result.error, violations: result.violations ?? [],
        });
      }
      return res.status(404).json({ error: result.error });
    }

    res.json({
      success: true,
      task_id: id,
      status: 'blocked',
      reason,
      blocked_until: result.task?.blocked_until || null,
    });
  } catch (err) {
    console.error('[API] tasks/:id/block error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


/**
 * POST /api/brain/tasks/:id/unblock
 * 手动解除任务阻塞，状态回 queued
 */
router.post('/tasks/:id/unblock', async (req, res) => {
  try {
    const { id } = req.params;

    const { unblockTask } = await import('../task-updater.js');
    const result = await unblockTask(id);

    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }

    res.json({
      success: true,
      task_id: id,
      status: 'queued',
    });
  } catch (err) {
    console.error('[API] tasks/:id/unblock error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
}
