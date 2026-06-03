import { Router } from 'express';
import pool from '../db.js';

const router = Router();

router.get('/phase-summary', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT phase, COUNT(*) AS count
       FROM initiative_runs
       WHERE phase IS NOT NULL
       GROUP BY phase
       ORDER BY count DESC`
    );
    const rows = result.rows.map((r) => ({
      phase: r.phase,
      count: Number(r.count),
    }));
    return res.json(rows);
  } catch (err) {
    console.error('[GET /initiative-runs/phase-summary]', err.message);
    return res.status(500).json({ error: 'internal server error' });
  }
});

export default router;
