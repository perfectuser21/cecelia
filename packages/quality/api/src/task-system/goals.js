import { Router } from 'express';
import pool from './db.js';

const router = Router();

// GET /api/goals - List goals
router.get('/', async (req, res) => {
  try {
    const { project_id } = req.query;
    
    let query = 'SELECT * FROM goals';
    let params = [];
    
    if (project_id) {
      query += ' WHERE project_id = $1';
      params.push(project_id);
    }
    
    query += ' ORDER BY created_at DESC';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list goals', details: err.message });
  }
});

// GET /api/goals/:id - Get goal detail
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM goals WHERE id = $1', [req.params.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get goal', details: err.message });
  }
});

// POST /api/goals - Create goal
router.post('/', async (req, res) => {
  try {
    const { project_id, title, description, status, priority, deadline, progress, metadata } = req.body;
    
    const result = await pool.query(
      'INSERT INTO goals (project_id, title, description, status, priority, deadline, progress, metadata) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [project_id, title, description, status || 'pending', priority || 'P2', deadline, progress || 0, metadata || {}]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create goal', details: err.message });
  }
});

// PATCH /api/goals/:id - Update goal
router.patch('/:id', async (req, res) => {
  try {
    const { title, description, status, priority, deadline, progress, metadata } = req.body;

    const updates = [];
    const params = [];
    let paramIndex = 1;

    // Validate at least one field to update
    if (!title && !description && !status && !priority && deadline === undefined && progress === undefined && !metadata) {
      return res.status(400).json({ error: 'At least one field must be provided for update' });
    }
    
    if (title !== undefined) {
      updates.push('title = $' + paramIndex++);
      params.push(title);
    }
    if (description !== undefined) {
      updates.push('description = $' + paramIndex++);
      params.push(description);
    }
    if (status !== undefined) {
      updates.push('status = $' + paramIndex++);
      params.push(status);
      if (status === 'completed') {
        updates.push('completed_at = NOW()');
      }
    }
    if (priority !== undefined) {
      updates.push('priority = $' + paramIndex++);
      params.push(priority);
    }
    if (deadline !== undefined) {
      updates.push('deadline = $' + paramIndex++);
      params.push(deadline);
    }
    if (progress !== undefined) {
      updates.push('progress = $' + paramIndex++);
      params.push(progress);
    }
    if (metadata !== undefined) {
      updates.push('metadata = $' + paramIndex++);
      params.push(metadata);
    }
    
    updates.push('updated_at = NOW()');
    params.push(req.params.id);
    
    const query = 'UPDATE goals SET ' + updates.join(', ') + ' WHERE id = $' + paramIndex + ' RETURNING *';
    const result = await pool.query(query, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update goal', details: err.message });
  }
});

// DELETE /api/goals/:id - Delete goal
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM goals WHERE id = $1 RETURNING id', [req.params.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    
    res.json({ message: 'Goal deleted', id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete goal', details: err.message });
  }
});

// GET /api/goals/:id/tasks - Get goal's tasks
router.get('/:id/tasks', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM tasks WHERE goal_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list goal tasks', details: err.message });
  }
});

export default router;
