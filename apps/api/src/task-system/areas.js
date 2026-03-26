/* global console */
import { Router } from 'express';
import pool from './db.js';

const router = Router();

// GET /api/areas - List all areas
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM areas ORDER BY created_at ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('Failed to list areas:', err);
    res.status(500).json({ error: 'Failed to list areas', details: err.message });
  }
});

// GET /api/areas/:id - Get area detail
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM areas WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Area not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Failed to get area:', err);
    res.status(500).json({ error: 'Failed to get area', details: err.message });
  }
});

export default router;
