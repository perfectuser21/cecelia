import { Router } from 'express';
import pool from './db.js';

const router = Router();

// GET /api/projects - List projects
router.get('/', async (req, res) => {
  try {
    const { workspace_id } = req.query;
    
    let query = 'SELECT * FROM projects';
    let params = [];
    
    if (workspace_id) {
      query += ' WHERE workspace_id = $1';
      params.push(workspace_id);
    }
    
    query += ' ORDER BY created_at DESC';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list projects', details: err.message });
  }
});

// GET /api/projects/:id - Get project detail
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get project', details: err.message });
  }
});

// POST /api/projects - Create project
router.post('/', async (req, res) => {
  try {
    const { workspace_id, name, description, repo_path, icon, color, status, metadata } = req.body;
    
    const result = await pool.query(
      'INSERT INTO projects (workspace_id, name, description, repo_path, icon, color, status, metadata) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [workspace_id, name, description, repo_path, icon || '📦', color || '#3b82f6', status || 'active', metadata || {}]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create project', details: err.message });
  }
});

// PATCH /api/projects/:id - Update project
router.patch('/:id', async (req, res) => {
  try {
    const { name, description, repo_path, icon, color, status, metadata } = req.body;

    const updates = [];
    const params = [];
    let paramIndex = 1;

    // Validate at least one field to update
    if (!name && !description && repo_path === undefined && !icon && !color && !status && !metadata) {
      return res.status(400).json({ error: 'At least one field must be provided for update' });
    }
    
    if (name !== undefined) {
      updates.push('name = $' + paramIndex++);
      params.push(name);
    }
    if (description !== undefined) {
      updates.push('description = $' + paramIndex++);
      params.push(description);
    }
    if (repo_path !== undefined) {
      updates.push('repo_path = $' + paramIndex++);
      params.push(repo_path);
    }
    if (icon !== undefined) {
      updates.push('icon = $' + paramIndex++);
      params.push(icon);
    }
    if (color !== undefined) {
      updates.push('color = $' + paramIndex++);
      params.push(color);
    }
    if (status !== undefined) {
      updates.push('status = $' + paramIndex++);
      params.push(status);
    }
    if (metadata !== undefined) {
      updates.push('metadata = $' + paramIndex++);
      params.push(metadata);
    }
    
    updates.push('updated_at = NOW()');
    params.push(req.params.id);
    
    const query = 'UPDATE projects SET ' + updates.join(', ') + ' WHERE id = $' + paramIndex + ' RETURNING *';
    const result = await pool.query(query, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update project', details: err.message });
  }
});

// DELETE /api/projects/:id - Delete project
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM projects WHERE id = $1 RETURNING id', [req.params.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    res.json({ message: 'Project deleted', id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete project', details: err.message });
  }
});

// GET /api/projects/:id/goals - Get project's goals
router.get('/:id/goals', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM goals WHERE project_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list project goals', details: err.message });
  }
});

// GET /api/projects/:id/tasks - Get project's tasks
router.get('/:id/tasks', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM tasks WHERE project_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list project tasks', details: err.message });
  }
});

// GET /api/projects/:id/stats - Get project statistics
router.get('/:id/stats', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT COUNT(DISTINCT g.id) as total_goals, COUNT(DISTINCT CASE WHEN g.status = \'completed\' THEN g.id END) as completed_goals, COUNT(DISTINCT t.id) as total_tasks, COUNT(DISTINCT CASE WHEN t.status = \'completed\' THEN t.id END) as completed_tasks, COUNT(DISTINCT CASE WHEN t.status = \'in_progress\' THEN t.id END) as in_progress_tasks, COUNT(DISTINCT CASE WHEN t.status = \'queued\' THEN t.id END) as queued_tasks, COUNT(DISTINCT CASE WHEN t.status = \'failed\' THEN t.id END) as failed_tasks FROM projects p LEFT JOIN goals g ON p.id = g.project_id LEFT JOIN tasks t ON p.id = t.project_id WHERE p.id = $1 GROUP BY p.id',
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get project stats', details: err.message });
  }
});

export default router;
