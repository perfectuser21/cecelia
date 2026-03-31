import { Router } from 'express';
import pg from 'pg';

const router = Router();

const pool = new pg.Pool({
  host: process.env.TIMESCALE_HOST || 'localhost',
  database: process.env.TIMESCALE_DB || 'social_data',
  user: process.env.TIMESCALE_USER || 'postgres',
  password: process.env.TIMESCALE_PASSWORD || '',
  port: parseInt(process.env.TIMESCALE_PORT || '5432'),
  connectionTimeoutMillis: 3000,
});

router.get('/trending', async (req, res) => {
  const platform = req.query.platform;
  const limit = parseInt(req.query.limit) || 50;
  const days = parseInt(req.query.days) || 7;

  try {
    let query = `SELECT * FROM v_all_platforms WHERE scraped_at >= NOW() - INTERVAL '${days} days'`;
    const params = [];

    if (platform) {
      params.push(platform);
      query += ` AND platform = $${params.length}`;
    }

    params.push(limit);
    query += ` ORDER BY scraped_at DESC LIMIT $${params.length}`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch {
    res.json([]);
  }
});

export default router;
