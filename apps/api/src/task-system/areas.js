/* global console */
import { Router } from 'express';
import pool from './db.js';

const router = Router();

// GET /api/areas - List all areas
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM areas ORDER BY sort_order ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('Failed to list areas:', err);
    res.status(500).json({ error: 'Failed to list areas', details: err.message });
  }
});

// GET /api/areas/:id - Get area detail with projects and goals
router.get('/:id', async (req, res) => {
  try {
    const areaResult = await pool.query('SELECT * FROM areas WHERE id = $1', [req.params.id]);
    if (areaResult.rows.length === 0) {
      return res.status(404).json({ error: 'Area not found' });
    }

    const area = areaResult.rows[0];

    const projectsResult = await pool.query(
      'SELECT * FROM projects WHERE area_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );

    const goalsResult = await pool.query(
      'SELECT g.* FROM goals g JOIN projects p ON g.project_id = p.id WHERE p.area_id = $1 ORDER BY g.created_at DESC',
      [req.params.id]
    );

    res.json({
      ...area,
      projects: projectsResult.rows,
      goals: goalsResult.rows,
    });
  } catch (err) {
    console.error('Failed to get area:', err);
    res.status(500).json({ error: 'Failed to get area', details: err.message });
  }
});

export default router;
