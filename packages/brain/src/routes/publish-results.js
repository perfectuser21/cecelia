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
 * GET /api/brain/publish-results/stats
 * 发布统计聚合 — 供 Dashboard 使用
 * Query: days (default 1 = 昨日) | 7 = 近7天
 */
router.get('/publish-results/stats', async (req, res) => {
  try {
    const days = Math.min(Number(req.query.days) || 1, 30);

    // 按平台+成功/失败分组统计
    const byPlatform = await pool.query(
      `SELECT
         platform,
         COUNT(*) FILTER (WHERE success = true)  AS success_count,
         COUNT(*) FILTER (WHERE success = false) AS fail_count,
         COUNT(*)                                 AS total_count,
         array_agg(DISTINCT error) FILTER (WHERE error IS NOT NULL AND success = false) AS fail_reasons
       FROM publish_results
       WHERE created_at >= NOW() - make_interval(days => $1)
       GROUP BY platform
       ORDER BY total_count DESC`,
      [days]
    );

    // 每日趋势（按天分组）
    const daily = await pool.query(
      `SELECT
         DATE(created_at AT TIME ZONE 'Asia/Shanghai') AS day,
         COUNT(*) FILTER (WHERE success = true)  AS success_count,
         COUNT(*) FILTER (WHERE success = false) AS fail_count
       FROM publish_results
       WHERE created_at >= NOW() - make_interval(days => $1)
       GROUP BY day
       ORDER BY day DESC`,
      [days]
    );

    const totalSuccess = byPlatform.rows.reduce((s, r) => s + Number(r.success_count), 0);
    const totalFail    = byPlatform.rows.reduce((s, r) => s + Number(r.fail_count), 0);
    const total        = totalSuccess + totalFail;

    res.json({
      success: true,
      period_days: days,
      total,
      total_success: totalSuccess,
      total_fail: totalFail,
      by_platform: byPlatform.rows.map(r => ({
        platform:      r.platform,
        success_count: Number(r.success_count),
        fail_count:    Number(r.fail_count),
        total_count:   Number(r.total_count),
        success_rate:  Number(r.total_count) > 0
          ? Math.round((Number(r.success_count) / Number(r.total_count)) * 100)
          : null,
        fail_reasons: r.fail_reasons?.filter(Boolean) || [],
      })),
      daily_trend: daily.rows,
    });
  } catch (err) {
    console.error('[publish-results] /stats 失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
