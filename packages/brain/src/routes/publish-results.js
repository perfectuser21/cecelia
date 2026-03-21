import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/**
 * POST /api/brain/publish-results
 * 写入发布结果（由 N8N 调用）
 *
 * Body: {
 *   platform: string,      // 'douyin' | 'kuaishou' | 'xiaohongshu' | ...
 *   contentType: string,   // 'video' | 'image' | 'article'
 *   success: boolean,
 *   workId?: string,       // 平台作品 ID
 *   url?: string,          // 作品管理链接
 *   error?: string,        // 失败原因
 *   title?: string,        // 内容标题
 *   taskId?: string,       // Brain Task ID（可选关联）
 * }
 */
router.post('/publish-results', async (req, res) => {
  try {
    const { platform, contentType, success, workId, url, error, title, taskId } = req.body;

    if (!platform) {
      return res.status(400).json({ success: false, error: 'platform 字段必填' });
    }
    if (typeof success !== 'boolean') {
      return res.status(400).json({ success: false, error: 'success 字段必须为 boolean' });
    }

    const result = await pool.query(
      `INSERT INTO publish_results
         (platform, content_type, success, work_id, url, error, title, task_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, created_at`,
      [
        platform,
        contentType || 'unknown',
        success,
        workId || null,
        url || null,
        error || null,
        title || null,
        taskId || null,
      ]
    );

    res.json({ success: true, id: result.rows[0].id, createdAt: result.rows[0].created_at });
  } catch (err) {
    console.error('[publish-results] POST 失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/brain/publish-results
 * 查询发布记录
 * Query: platform, limit (default 20)
 */
router.get('/publish-results', async (req, res) => {
  try {
    const { platform, limit = 20 } = req.query;
    const params = [];
    let where = '';
    if (platform) {
      params.push(platform);
      where = `WHERE platform = $1`;
    }
    params.push(Math.min(Number(limit) || 20, 100));

    const result = await pool.query(
      `SELECT id, platform, content_type, success, work_id, url, error, title, task_id, created_at
       FROM publish_results
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    );

    res.json({ success: true, results: result.rows });
  } catch (err) {
    console.error('[publish-results] GET 失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/brain/publish-stats
 * 各平台发布成功率统计
 * Query: days (default 7, max 90)
 */
router.get('/publish-stats', async (req, res) => {
  try {
    const days = Math.min(Number(req.query.days) || 7, 90);

    const result = await pool.query(
      `SELECT
         platform,
         COUNT(*) AS total,
         SUM(CASE WHEN success THEN 1 ELSE 0 END) AS succeeded,
         SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) AS failed,
         ROUND(
           100.0 * SUM(CASE WHEN success THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0),
           1
         ) AS success_rate_pct
       FROM publish_results
       WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
       GROUP BY platform
       ORDER BY platform`,
      [days]
    );

    const stats = result.rows.map(r => ({
      platform: r.platform,
      total: Number(r.total),
      succeeded: Number(r.succeeded),
      failed: Number(r.failed),
      success_rate_pct: r.success_rate_pct !== null ? Number(r.success_rate_pct) : null,
    }));

    res.json({ success: true, days, stats });
  } catch (err) {
    console.error('[publish-stats] GET 失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
