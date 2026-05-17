import { Router } from 'express';
import pool from './db.js';

const router = Router();

// GET /api/tasks/areas — 从 areas 表查询
router.get('/', async (req, res) => {
  try {
    const { archived } = req.query;
    const showArchived = archived === 'true';
    const result = await pool.query(
      `SELECT id, name, domain, archived, created_at, updated_at
       FROM areas
       WHERE archived = $1
       ORDER BY name`,
      [showArchived]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list areas', details: err.message });
  }
});

// GET /api/tasks/areas/:id - Get area detail
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM areas WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Area not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get area', details: err.message });
  }
});

export default router;
