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

// POST /api/projects - Create project (or Feature if parent_id provided)
router.post('/', async (req, res) => {
  try {
    const { workspace_id, parent_id, name, description, repo_path, icon, color, status, metadata } = req.body;

    const result = await pool.query(
      'INSERT INTO projects (workspace_id, parent_id, name, description, repo_path, icon, color, status, metadata) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
      [workspace_id, parent_id || null, name, description, repo_path, icon || '📦', color || '#3b82f6', status || 'active', metadata || {}]
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

// GET /api/projects/:id/children - Get project's sub-projects (Features)
router.get('/:id/children', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM projects WHERE parent_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list sub-projects', details: err.message });
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

// GET /api/projects/:id/health - Get project health score
router.get('/:id/health', async (req, res) => {
  try {
    const projectCheck = await pool.query('SELECT id FROM projects WHERE id = $1', [req.params.id]);
    if (projectCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const projectId = req.params.id;

    const taskResult = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'in_progress' AND updated_at < NOW() - INTERVAL '7 days') as stale,
        COUNT(*) FILTER (WHERE updated_at >= NOW() - INTERVAL '7 days') as recently_active
      FROM tasks WHERE project_id = $1
    `, [projectId]);

    const goalResult = await pool.query(`
      SELECT
        COUNT(*) as total,
        COALESCE(AVG(progress), 0) as avg_progress
      FROM goals WHERE project_id = $1
    `, [projectId]);

    const tasks = taskResult.rows[0];
    const goals = goalResult.rows[0];
    const totalTasks = parseInt(tasks.total);
    const totalGoals = parseInt(goals.total);

    if (totalTasks === 0 && totalGoals === 0) {
      return res.json({
        health_score: 0,
        health_status: 'critical',
        message: 'No tasks or goals found for this project',
        breakdown: {
          task_completion: { score: 0, weight: 0.4, completed: 0, total: 0 },
          goal_progress: { score: 0, weight: 0.3, avg_progress: 0, total: 0 },
          stale_tasks: { score: 0, weight: 0.2, stale_count: 0, total: 0 },
          activity: { score: 0, weight: 0.1, recently_active: 0, total: 0 }
        }
      });
    }

    const taskCompletionScore = totalTasks > 0
      ? (parseInt(tasks.completed) / totalTasks) * 100
      : 0;

    const goalProgressScore = parseFloat(goals.avg_progress);

    const staleScore = totalTasks > 0
      ? (1 - parseInt(tasks.stale) / totalTasks) * 100
      : 100;

    const activityScore = totalTasks > 0
      ? (parseInt(tasks.recently_active) / totalTasks) * 100
      : 0;

    const healthScore = Math.round(
      taskCompletionScore * 0.4 +
      goalProgressScore * 0.3 +
      staleScore * 0.2 +
      activityScore * 0.1
    );

    const clampedScore = Math.max(0, Math.min(100, healthScore));

    let healthStatus;
    if (clampedScore >= 70) healthStatus = 'healthy';
    else if (clampedScore >= 40) healthStatus = 'at_risk';
    else healthStatus = 'critical';

    res.json({
      health_score: clampedScore,
      health_status: healthStatus,
      breakdown: {
        task_completion: {
          score: Math.round(taskCompletionScore),
          weight: 0.4,
          completed: parseInt(tasks.completed),
          total: totalTasks
        },
        goal_progress: {
          score: Math.round(goalProgressScore),
          weight: 0.3,
          avg_progress: Math.round(parseFloat(goals.avg_progress)),
          total: totalGoals
        },
        stale_tasks: {
          score: Math.round(staleScore),
          weight: 0.2,
          stale_count: parseInt(tasks.stale),
          total: totalTasks
        },
        activity: {
          score: Math.round(activityScore),
          weight: 0.1,
          recently_active: parseInt(tasks.recently_active),
          total: totalTasks
        }
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get project health', details: err.message });
  }
});

export default router;
