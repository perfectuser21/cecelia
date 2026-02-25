import { Router } from 'express';
import pool from './db.js';

const router = Router();

// GET /api/runs - List runs
router.get('/', async (req, res) => {
  try {
    const { task_id } = req.query;
    
    let query = 'SELECT r.*, t.title as task_title FROM runs r JOIN tasks t ON r.task_id = t.id';
    const params = [];
    
    if (task_id) {
      query += ' WHERE r.task_id = $1';
      params.push(task_id);
    }
    
    query += ' ORDER BY r.started_at DESC';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list runs', details: err.message });
  }
});

// GET /api/runs/:id - Get run detail
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT r.*, t.title as task_title FROM runs r JOIN tasks t ON r.task_id = t.id WHERE r.id = $1',
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Run not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get run', details: err.message });
  }
});

// POST /api/runs - Create run (use task_id in body instead)
router.post('/', async (req, res) => {
  try {
    const { task_id, status, result, logs, evidence_files } = req.body;

    if (!task_id) {
      return res.status(400).json({ error: 'task_id is required' });
    }
    
    const queryResult = await pool.query(
      'INSERT INTO runs (task_id, status, result, logs, evidence_files) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [task_id, status || 'running', result || {}, logs, evidence_files || []]
    );
    
    res.status(201).json(queryResult.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create run', details: err.message });
  }
});

export default router;
