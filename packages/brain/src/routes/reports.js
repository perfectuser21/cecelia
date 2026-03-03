/**
 * System Reports 路由 — 48h 系统简报 API
 *
 * GET /api/brain/reports
 *   返回简报列表（支持 ?type=&limit= 参数）
 *
 * GET /api/brain/reports/:id
 *   返回简报详情（包含完整 content）
 *
 * POST /api/brain/reports/generate
 *   手动触发生成一份系统简报（调试用）
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/**
 * GET /
 * 获取简报列表
 */
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const type = req.query.type || null;

    let query;
    let params;

    if (type) {
      query = `
        SELECT
          id,
          type,
          created_at,
          metadata
        FROM system_reports
        WHERE type = $1
        ORDER BY created_at DESC
        LIMIT $2
      `;
      params = [type, limit];
    } else {
      query = `
        SELECT
          id,
          type,
          created_at,
          metadata
        FROM system_reports
        ORDER BY created_at DESC
        LIMIT $1
      `;
      params = [limit];
    }

    const { rows } = await pool.query(query, params);

    res.json({
      ok: true,
      records: rows,
      count: rows.length,
    });
  } catch (err) {
    console.error('[reports] GET /api/brain/reports 失败:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /generate
 * 手动触发生成一份系统简报（调试/端到端测试用）
 * 必须在 GET /:id 之前注册，避免 :id 捕获 "generate"
 */
router.post('/generate', async (_req, res) => {
  try {
    // 收集系统状态数据
    const [tasksResult, goalsResult] = await Promise.all([
      pool.query(`
        SELECT
          status,
          COUNT(*) as count
        FROM tasks
        WHERE created_at > NOW() - INTERVAL '48 hours'
        GROUP BY status
      `),
      pool.query(`
        SELECT
          id, title, status, progress
        FROM goals
        WHERE status != 'completed'
        LIMIT 10
      `),
    ]);

    // 统计任务数据
    const taskStats = { queued: 0, in_progress: 0, completed: 0, failed: 0 };
    for (const row of tasksResult.rows) {
      taskStats[row.status] = parseInt(row.count);
    }

    // 构建简报内容
    const content = {
      summary: `系统简报 - ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
      task_stats: {
        last_48h: taskStats,
        total: Object.values(taskStats).reduce((a, b) => a + b, 0),
      },
      kr_progress: goalsResult.rows.map(g => ({
        id: g.id,
        title: g.title,
        status: g.status,
        progress: g.progress || 0,
      })),
      system_health: {
        brain: 'ok',
        database: 'ok',
        generated_at: new Date().toISOString(),
      },
      anomalies: [],
      risks: [],
    };

    const metadata = {
      generated_by: 'manual_trigger',
      push_status: 'not_pushed',
    };

    // 写入数据库
    const { rows } = await pool.query(
      `INSERT INTO system_reports (type, content, metadata)
       VALUES ($1, $2, $3)
       RETURNING id, type, created_at, metadata`,
      ['48h_briefing', JSON.stringify(content), JSON.stringify(metadata)]
    );

    res.json({
      ok: true,
      message: '简报生成成功',
      record: rows[0],
    });
  } catch (err) {
    console.error('[reports] POST /generate 失败:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /:id
 * 获取简报详情（包含完整 content）
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(
      `SELECT
        id,
        type,
        content,
        metadata,
        created_at
       FROM system_reports
       WHERE id = $1`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: '简报不存在' });
    }

    res.json({
      ok: true,
      record: rows[0],
    });
  } catch (err) {
    console.error('[reports] GET /api/brain/reports/:id 失败:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
