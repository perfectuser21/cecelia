import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// POST /api/brain/dev-logs - 记录执行日志
router.post('/', async (req, res) => {
  try {
    const { task_id, run_id, phase, status, error_message, metadata, started_at, completed_at } = req.body;

    if (!task_id || !run_id || !phase || !status) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['task_id', 'run_id', 'phase', 'status']
      });
    }

    const result = await pool.query(
      `INSERT INTO dev_execution_logs
        (task_id, run_id, phase, status, error_message, metadata, started_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        task_id,
        run_id,
        phase,
        status,
        error_message || null,
        metadata ? JSON.stringify(metadata) : null,
        started_at || new Date().toISOString(),
        completed_at || null
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[dev-logs] POST error:', err.message);
    res.status(500).json({ error: 'Failed to create dev log', details: err.message });
  }
});

// GET /api/brain/dev-logs/stats - 统计成功率和各阶段失败分布
// 注意：此路由必须在 /:task_id 之前定义，避免 "stats" 被误解为 task_id
router.get('/stats', async (req, res) => {
  try {
    // 总体成功率统计
    const overallResult = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'success') AS success_count,
         COUNT(*) FILTER (WHERE status = 'failure') AS failure_count,
         COUNT(*) AS total_count,
         ROUND(
           COUNT(*) FILTER (WHERE status = 'success')::numeric /
           NULLIF(COUNT(*), 0) * 100,
           2
         ) AS success_rate
       FROM dev_execution_logs`
    );

    // 各阶段失败分布
    const phaseResult = await pool.query(
      `SELECT
         phase,
         COUNT(*) FILTER (WHERE status = 'failure') AS failure_count,
         COUNT(*) AS total_count,
         ROUND(
           COUNT(*) FILTER (WHERE status = 'failure')::numeric /
           NULLIF(COUNT(*), 0) * 100,
           2
         ) AS failure_rate
       FROM dev_execution_logs
       GROUP BY phase
       ORDER BY failure_count DESC`
    );

    // 最近 7 天趋势
    const trendResult = await pool.query(
      `SELECT
         DATE_TRUNC('day', created_at) AS day,
         COUNT(*) FILTER (WHERE status = 'success') AS success_count,
         COUNT(*) FILTER (WHERE status = 'failure') AS failure_count
       FROM dev_execution_logs
       WHERE created_at > NOW() - INTERVAL '7 days'
       GROUP BY DATE_TRUNC('day', created_at)
       ORDER BY day ASC`
    );

    res.json({
      overall: overallResult.rows[0],
      by_phase: phaseResult.rows,
      trend_7d: trendResult.rows
    });
  } catch (err) {
    console.error('[dev-logs] GET stats error:', err.message);
    res.status(500).json({ error: 'Failed to get dev stats', details: err.message });
  }
});

// GET /api/brain/dev-logs/:task_id - 查询任务执行历史
router.get('/:task_id', async (req, res) => {
  try {
    const { task_id } = req.params;
    const { limit = '50', offset = '0' } = req.query;

    const result = await pool.query(
      `SELECT * FROM dev_execution_logs
       WHERE task_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [task_id, parseInt(limit, 10), parseInt(offset, 10)]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('[dev-logs] GET task logs error:', err.message);
    res.status(500).json({ error: 'Failed to get dev logs', details: err.message });
  }
});

export default router;
