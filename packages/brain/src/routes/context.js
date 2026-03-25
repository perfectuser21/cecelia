import { Router } from 'express';
import pool from '../db.js';
import { runConversationConsolidator } from '../conversation-consolidator.js';

const router = Router();

/**
 * GET /api/brain/context
 * 跨对话感知汇总接口 — 一次返回 OKR状态 + 活跃任务 + 近期决策
 */
router.get('/context', async (req, res) => {
  try {
    const [okrResult, tasksResult, decisionsResult] = await Promise.all([
      pool.query(`
        SELECT id, 'objective' AS type, title, status, NULL::numeric AS progress, NULL::uuid AS parent_id
        FROM objectives
        WHERE status NOT IN ('completed', 'cancelled')
        UNION ALL
        SELECT id, 'key_result' AS type, title, status,
               CASE WHEN target_value > 0 THEN ROUND(current_value / target_value * 100) ELSE 0 END AS progress,
               objective_id AS parent_id
        FROM key_results
        WHERE status NOT IN ('completed', 'cancelled')
        ORDER BY type, status
        LIMIT 50
      `),
      pool.query(`
        SELECT id, title, priority, status, project_id, queued_at, updated_at
        FROM tasks
        WHERE status NOT IN ('completed', 'cancelled')
        ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
                 created_at ASC
        LIMIT 20
      `),
      pool.query(`
        SELECT id, ts, trigger, input_summary, status
        FROM decision_log
        ORDER BY ts DESC
        LIMIT 10
      `),
    ]);

    res.json({
      okr: okrResult.rows,
      tasks: tasksResult.rows,
      decisions: decisionsResult.rows,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get context', details: err.message });
  }
});

/**
 * GET /api/brain/okr/current
 * 当前 OKR 进度（objectives + key_results，带进度百分比）
 */
router.get('/okr/current', async (req, res) => {
  try {
    const objectivesResult = await pool.query(`
      SELECT o.id, o.title, o.status, o.metadata,
             COUNT(kr.id) FILTER (WHERE kr.status NOT IN ('completed', 'cancelled')) AS active_krs,
             COUNT(kr.id) AS total_krs,
             ROUND(AVG(CASE WHEN kr.target_value > 0 THEN kr.current_value / kr.target_value * 100 ELSE 0 END)) AS avg_progress
      FROM objectives o
      LEFT JOIN key_results kr ON kr.objective_id = o.id
      WHERE o.status NOT IN ('completed', 'cancelled')
      GROUP BY o.id, o.title, o.status, o.metadata
      ORDER BY o.created_at ASC
    `);

    const krsResult = await pool.query(`
      SELECT kr.id, kr.objective_id, kr.title, kr.status,
             kr.current_value, kr.target_value, kr.unit,
             CASE WHEN kr.target_value > 0
               THEN ROUND(kr.current_value / kr.target_value * 100)
               ELSE 0
             END AS progress_pct
      FROM key_results kr
      WHERE kr.status NOT IN ('completed', 'cancelled')
      ORDER BY kr.objective_id, kr.created_at ASC
    `);

    res.json({
      objectives: objectivesResult.rows,
      key_results: krsResult.rows,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get OKR current', details: err.message });
  }
});

/**
 * POST /api/brain/consolidate
 * 主动触发 conversation-consolidator（Stop Hook 调用）
 * fire-and-forget：立即返回 202，后台异步执行
 */
router.post('/consolidate', async (req, res) => {
  res.status(202).json({ status: 'accepted', message: '对话压缩任务已提交，后台异步执行' });
  Promise.resolve()
    .then(() => runConversationConsolidator())
    .catch(e => console.warn('[context/consolidate] 对话压缩失败:', e.message));
});

export default router;
