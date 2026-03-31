import { Router } from 'express';
import pg from 'pg';

const { Pool } = pg;

const router = Router();

// 懒创建 TimescaleDB 连接池（仅在需要时初始化）
let tsPool = null;

function getTimescalePool() {
  if (!tsPool) {
    tsPool = new Pool({
      host: process.env.TIMESCALE_HOST || 'localhost',
      port: parseInt(process.env.TIMESCALE_PORT || '5432'),
      database: process.env.TIMESCALE_DB || 'tsdb',
      user: process.env.TIMESCALE_USER || 'postgres',
      password: process.env.TIMESCALE_PASSWORD || '',
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000,
      max: 5,
    });
  }
  return tsPool;
}

// GET /social/trending
// 支持 ?platform=xxx 过滤，?limit=N（默认 20，最大 100）
router.get('/trending', async (req, res) => {
  const { platform } = req.query;
  const rawLimit = parseInt(req.query.limit) || 20;
  const limit = Math.min(Math.max(rawLimit, 1), 100);

  try {
    const pool = getTimescalePool();
    const params = [];
    let whereClause = '';

    if (platform) {
      params.push(platform);
      whereClause = `WHERE platform = $${params.length}`;
    }

    params.push(limit);
    const limitPlaceholder = `$${params.length}`;

    const sql = `
      SELECT title, views, likes, comments, platform, scraped_at
      FROM v_all_platforms
      ${whereClause}
      ORDER BY scraped_at DESC
      LIMIT ${limitPlaceholder}
    `;

    const result = await pool.query(sql, params);
    return res.json(result.rows);
  } catch (err) {
    // TimescaleDB 不可达或表不存在时降级返回空数组，不报 500
    console.error('[social-trending] TimescaleDB 查询失败，降级返回空数组:', err.message);
    return res.json([]);
  }
});

export default router;
