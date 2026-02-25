import { Router } from 'express';
import pool from './db.js';

const router = Router();

// GET /api/tasks - List tasks with filtering
router.get('/', async (req, res) => {
  try {
    const { project_id, goal_id, status, priority } = req.query;
    
    let query = 'SELECT * FROM tasks WHERE 1=1';
    const params = [];
    let paramIndex = 1;
    
    if (project_id) {
      query += ' AND project_id = $' + paramIndex++;
      params.push(project_id);
    }
    if (goal_id) {
      query += ' AND goal_id = $' + paramIndex++;
      params.push(goal_id);
    }
    if (status) {
      query += ' AND status = $' + paramIndex++;
      params.push(status);
    }
    if (priority) {
      query += ' AND priority = $' + paramIndex++;
      params.push(priority);
    }
    
    query += ' ORDER BY created_at DESC';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list tasks', details: err.message });
  }
});

// GET /api/tasks/:id - Get task detail
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get task', details: err.message });
  }
});

// POST /api/tasks - Create task
router.post('/', async (req, res) => {
  try {
    const { project_id, goal_id, title, description, intent, priority, status, payload, tags } = req.body;
    
    const result = await pool.query(
      'INSERT INTO tasks (project_id, goal_id, title, description, intent, priority, status, payload, tags) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
      [project_id, goal_id, title, description, intent || 'general', priority || 'P2', status || 'queued', payload || {}, tags || []]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create task', details: err.message });
  }
});

// PATCH /api/tasks/:id - Update task
router.patch('/:id', async (req, res) => {
  try {
    const { title, description, intent, priority, status, payload, tags, worker_id, error, custom_props } = req.body;

    const updates = [];
    const params = [];
    let paramIndex = 1;

    // Validate at least one field to update
    if (!title && !description && !intent && !priority && !status && !payload && !tags && !worker_id && error === undefined && !custom_props) {
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
    if (intent !== undefined) {
      updates.push('intent = $' + paramIndex++);
      params.push(intent);
    }
    if (priority !== undefined) {
      updates.push('priority = $' + paramIndex++);
      params.push(priority);
    }
    if (status !== undefined) {
      updates.push('status = $' + paramIndex++);
      params.push(status);
      
      if (status === 'in_progress') {
        updates.push('started_at = NOW()');
      } else if (status === 'completed') {
        updates.push('completed_at = NOW()');
      }
    }
    if (payload !== undefined) {
      updates.push('payload = $' + paramIndex++);
      params.push(payload);
    }
    if (tags !== undefined) {
      updates.push('tags = $' + paramIndex++);
      params.push(tags);
    }
    if (worker_id !== undefined) {
      updates.push('worker_id = $' + paramIndex++);
      params.push(worker_id);
    }
    if (error !== undefined) {
      updates.push('error = $' + paramIndex++);
      params.push(error);
    }
    if (custom_props !== undefined) {
      updates.push('custom_props = custom_props || $' + paramIndex++);
      params.push(JSON.stringify(custom_props));
    }

    params.push(req.params.id);
    
    const query = 'UPDATE tasks SET ' + updates.join(', ') + ' WHERE id = $' + paramIndex + ' RETURNING *';
    const result = await pool.query(query, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update task', details: err.message });
  }
});

// DELETE /api/tasks/:id - Delete task
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM tasks WHERE id = $1 RETURNING id', [req.params.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    res.json({ message: 'Task deleted', id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete task', details: err.message });
  }
});

// GET /api/tasks/:id/backlinks - Get backlinks (who blocks this task)
router.get('/:id/backlinks', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT t.id, t.title, t.status, t.priority, tl.link_type, p.name as project_name FROM task_links tl JOIN tasks t ON tl.source_task_id = t.id JOIN projects p ON t.project_id = p.id WHERE tl.target_task_id = $1',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get backlinks', details: err.message });
  }
});

// GET /api/tasks/:id/runs - Get task runs
router.get('/:id/runs', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM runs WHERE task_id = $1 ORDER BY started_at DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get task runs', details: err.message });
  }
});

export default router;
