import { Router } from 'express';
import pool from '../db.js';
import { getPublishStats } from '../publish-monitor.js';

const router = Router();

/**
 * GET /api/brain/publish-jobs
 * 查询发布任务列表
 * Query: platform, status, limit (default 100)
 */
router.get('/publish-jobs', async (req, res) => {
  try {
    const { platform, status, limit = 100 } = req.query;
    const params = [];
    const conditions = [];

    if (platform) {
      params.push(platform);
      conditions.push(`platform = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(Math.min(Number(limit) || 100, 500));

    const result = await pool.query(
      `SELECT id, platform, content_type, payload, status, task_id,
              error_message, started_at, completed_at, created_at, updated_at
       FROM content_publish_jobs
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    );

    res.json({ success: true, jobs: result.rows });
  } catch (err) {
    console.error('[publish-jobs] GET 失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/brain/publish-jobs
 * 创建发布任务 job
 *
 * Body: {
 *   platform: string,       // 必填：douyin/kuaishou/xiaohongshu/toutiao/weibo/shipinhao/zhihu/wechat
 *   content_type: string,   // 必填：video/image/article/idea
 *   payload?: object,       // 发布参数（标题、文件路径等）
 *   task_id?: string,       // 关联 Brain Task ID
 *   status?: string,        // 初始状态，默认 pending
 * }
 */
router.post('/publish-jobs', async (req, res) => {
  try {
    const { platform, content_type, payload = {}, task_id, status = 'pending' } = req.body;

    if (!platform) {
      return res.status(400).json({ success: false, error: 'platform 字段必填' });
    }
    if (!content_type) {
      return res.status(400).json({ success: false, error: 'content_type 字段必填' });
    }

    const validStatuses = ['pending', 'running', 'success', 'failed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: `status 无效，允许值: ${validStatuses.join('/')}` });
    }

    const result = await pool.query(
      `INSERT INTO content_publish_jobs
         (platform, content_type, payload, status, task_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, platform, content_type, status, task_id, created_at`,
      [
        platform,
        content_type,
        JSON.stringify(payload),
        status,
        task_id || null,
      ]
    );

    res.status(201).json({ success: true, ...result.rows[0] });
  } catch (err) {
    console.error('[publish-jobs] POST 失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/brain/publish-jobs/retry/:id
 * 重跑失败的 job（重置状态为 pending）
 */
router.post('/publish-jobs/retry/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE content_publish_jobs
       SET status = 'pending', error_message = NULL, started_at = NULL,
           completed_at = NULL, updated_at = NOW()
       WHERE id = $1
       RETURNING id, platform, content_type, status, updated_at`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: `job ${id} 不存在` });
    }

    res.json({ success: true, ...result.rows[0] });
  } catch (err) {
    console.error('[publish-jobs] retry 失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/brain/publish/success-rate
 * 每日发布成功率趋势（来自 publish_success_daily 快照表）
 * Query: days (default 7, max 90), platform (optional, default all)
 * Returns: [{date, success_rate, total, completed, failed}, ...]
 */
router.get('/success-rate', async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
    const { platform } = req.query;

    let rows;
    if (platform) {
      const result = await pool.query(
        `SELECT
           date::text,
           total,
           completed,
           failed,
           success_rate
         FROM publish_success_daily
         WHERE platform = $1
           AND date >= CURRENT_DATE - ($2 - 1) * INTERVAL '1 day'
         ORDER BY date ASC`,
        [platform, days]
      );
      rows = result.rows;
    } else {
      const result = await pool.query(
        `SELECT
           date::text,
           SUM(total)::int                                                      AS total,
           SUM(completed)::int                                                   AS completed,
           SUM(failed)::int                                                      AS failed,
           CASE WHEN SUM(total) > 0
             THEN ROUND(SUM(completed)::numeric / SUM(total) * 100, 2)
             ELSE NULL
           END                                                                   AS success_rate
         FROM publish_success_daily
         WHERE date >= CURRENT_DATE - ($1 - 1) * INTERVAL '1 day'
         GROUP BY date
         ORDER BY date ASC`,
        [days]
      );
      rows = result.rows;
    }

    res.json(rows.map(r => ({
      date:         r.date,
      success_rate: r.success_rate !== null ? Number(r.success_rate) : null,
      total:        Number(r.total),
      completed:    Number(r.completed),
      failed:       Number(r.failed),
    })));
  } catch (err) {
    console.error('[publish] /success-rate 失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/brain/publish/stats
 * 返回今日发布统计：成功率、覆盖平台数、各平台状态
 */
router.get('/stats', async (_req, res) => {
  try {
    const cached = await getPublishStats(pool);

    // 同时返回今日实时 content_publish tasks 状态
    const { rows } = await pool.query(
      `SELECT
         status,
         payload->>'platform' AS platform,
         COUNT(*) AS cnt
       FROM tasks
       WHERE task_type = 'content_publish'
         AND DATE(created_at AT TIME ZONE 'UTC') = CURRENT_DATE
       GROUP BY status, payload->>'platform'`
    );

    const live = { queued: 0, in_progress: 0, completed: 0, failed: 0, total: 0, platforms: {} };
    for (const row of rows) {
      const n = parseInt(row.cnt, 10);
      live[row.status] = (live[row.status] || 0) + n;
      live.total += n;
      if (row.platform) {
        if (!live.platforms[row.platform]) live.platforms[row.platform] = {};
        live.platforms[row.platform][row.status] = n;
      }
    }
    const done = live.completed + live.failed;
    live.success_rate = done > 0 ? Math.round((live.completed / done) * 100) : null;
    live.coverage = Object.keys(live.platforms).filter(p => live.platforms[p].completed > 0).length;
    live.date = new Date().toISOString().slice(0, 10);

    res.json({ success: true, stats: live, cached });
  } catch (err) {
    console.error('[publish-jobs] stats 失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
