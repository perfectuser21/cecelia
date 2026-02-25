import { Router } from 'express';
import pool from './db.js';

const router = Router();

// ==================== State Machine ====================

export const VALID_STATUSES = ['planning', 'active', 'reviewing', 'completed', 'archived', 'paused'];

export const VALID_TRANSITIONS = {
  planning: ['active', 'archived'],
  active: ['reviewing', 'planning', 'paused', 'archived'],
  reviewing: ['completed', 'active', 'archived'],
  completed: ['archived'],
  archived: [],
  paused: ['active', 'archived'],
};

export function validateTransition(from, to) {
  if (!VALID_STATUSES.includes(to)) {
    return { valid: false, error: `Invalid status '${to}'. Valid statuses: ${VALID_STATUSES.join(', ')}` };
  }
  if (!VALID_TRANSITIONS[from]?.includes(to)) {
    return { valid: false, error: `Invalid transition from '${from}' to '${to}'. Allowed: ${VALID_TRANSITIONS[from]?.join(', ') || 'none'}` };
  }
  return { valid: true };
}

// GET /api/projects - List projects
router.get('/', async (req, res) => {
  try {
    const { workspace_id, area_id, status, parent_id, top_level } = req.query;

    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (workspace_id) {
      conditions.push(`workspace_id = $${paramIndex++}`);
      params.push(workspace_id);
    }
    if (area_id) {
      conditions.push(`area_id = $${paramIndex++}`);
      params.push(area_id);
    }
    if (status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(status);
    }
    // parent_id takes priority over top_level
    if (parent_id) {
      conditions.push(`parent_id = $${paramIndex++}`);
      params.push(parent_id);
    } else if (top_level === 'true') {
      conditions.push('parent_id IS NULL');
    }

    let query = 'SELECT * FROM projects';
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
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

    const effectiveStatus = status || 'planning';
    if (!VALID_STATUSES.includes(effectiveStatus)) {
      return res.status(400).json({ error: `Invalid status '${effectiveStatus}'. Valid statuses: ${VALID_STATUSES.join(', ')}` });
    }

    const result = await pool.query(
      'INSERT INTO projects (workspace_id, parent_id, name, description, repo_path, icon, color, status, metadata) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
      [workspace_id, parent_id || null, name, description, repo_path, icon || '📦', color || '#3b82f6', effectiveStatus, metadata || {}]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create project', details: err.message });
  }
});

// PATCH /api/projects/:id - Update project
router.patch('/:id', async (req, res) => {
  try {
    const { name, description, repo_path, icon, color, status, metadata, custom_props } = req.body;

    const updates = [];
    const params = [];
    let paramIndex = 1;

    // Validate at least one field to update
    if (!name && !description && repo_path === undefined && !icon && !color && !status && !metadata && !custom_props) {
      return res.status(400).json({ error: 'At least one field must be provided for update' });
    }

    // Validate status transition if status is being updated
    if (status !== undefined) {
      const current = await pool.query('SELECT status FROM projects WHERE id = $1', [req.params.id]);
      if (current.rows.length === 0) {
        return res.status(404).json({ error: 'Project not found' });
      }
      const result = validateTransition(current.rows[0].status, status);
      if (!result.valid) {
        return res.status(400).json({ error: result.error });
      }
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
    if (custom_props !== undefined) {
      updates.push('custom_props = custom_props || $' + paramIndex++);
      params.push(JSON.stringify(custom_props));
    }

    updates.push('updated_at = NOW()');
    params.push(req.params.id);

    const query = 'UPDATE projects SET ' + updates.join(', ') + ' WHERE id = $' + paramIndex + ' RETURNING *';
    const updateResult = await pool.query(query, params);

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json(updateResult.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update project', details: err.message });
  }
});

// POST /api/projects/:id/transition - Transition project status
router.post('/:id/transition', async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'status is required' });
    }

    const current = await pool.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const project = current.rows[0];
    const result = validateTransition(project.status, status);
    if (!result.valid) {
      return res.status(400).json({ error: result.error });
    }

    const updated = await pool.query(
      'UPDATE projects SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );

    res.json({
      project: updated.rows[0],
      transition: { from: project.status, to: status },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to transition project status', details: err.message });
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

// GET /api/projects/:id/dashboard - Get project dashboard overview
router.get('/:id/dashboard', async (req, res) => {
  try {
    const projectId = req.params.id;

    // Project basic info
    const projectResult = await pool.query('SELECT * FROM projects WHERE id = $1', [projectId]);
    if (projectResult.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const project = projectResult.rows[0];

    // Stats: task counts by status
    const statsResult = await pool.query(`
      SELECT
        COUNT(*) as total_tasks,
        COUNT(*) FILTER (WHERE status = 'completed') as completed_tasks,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress_tasks,
        COUNT(*) FILTER (WHERE status = 'queued') as queued_tasks,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_tasks
      FROM tasks WHERE project_id = $1
    `, [projectId]);

    const goalCountResult = await pool.query(`
      SELECT
        COUNT(*) as total_goals,
        COUNT(*) FILTER (WHERE status = 'completed') as completed_goals
      FROM goals WHERE project_id = $1
    `, [projectId]);

    const stats = {
      ...statsResult.rows[0],
      ...goalCountResult.rows[0]
    };

    // Health score (same logic as /health endpoint)
    const taskResult = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'in_progress' AND updated_at < NOW() - INTERVAL '7 days') as stale,
        COUNT(*) FILTER (WHERE updated_at >= NOW() - INTERVAL '7 days') as recently_active
      FROM tasks WHERE project_id = $1
    `, [projectId]);

    const goalHealthResult = await pool.query(`
      SELECT
        COUNT(*) as total,
        COALESCE(AVG(progress), 0) as avg_progress
      FROM goals WHERE project_id = $1
    `, [projectId]);

    const tasks = taskResult.rows[0];
    const goalsHealth = goalHealthResult.rows[0];
    const totalTasks = parseInt(tasks.total);
    const totalGoals = parseInt(goalsHealth.total);

    let healthScore = 0;
    let healthStatus = 'critical';

    if (totalTasks > 0 || totalGoals > 0) {
      const taskCompletionScore = totalTasks > 0 ? (parseInt(tasks.completed) / totalTasks) * 100 : 0;
      const goalProgressScore = parseFloat(goalsHealth.avg_progress);
      const staleScore = totalTasks > 0 ? (1 - parseInt(tasks.stale) / totalTasks) * 100 : 100;
      const activityScore = totalTasks > 0 ? (parseInt(tasks.recently_active) / totalTasks) * 100 : 0;

      healthScore = Math.max(0, Math.min(100, Math.round(
        taskCompletionScore * 0.4 + goalProgressScore * 0.3 + staleScore * 0.2 + activityScore * 0.1
      )));

      if (healthScore >= 70) healthStatus = 'healthy';
      else if (healthScore >= 40) healthStatus = 'at_risk';
    }

    const health = { health_score: healthScore, health_status: healthStatus };

    // Goals list with progress
    const goalsResult = await pool.query(
      'SELECT * FROM goals WHERE project_id = $1 ORDER BY created_at DESC',
      [projectId]
    );

    // Features (sub-projects)
    const featuresResult = await pool.query(
      'SELECT * FROM projects WHERE parent_id = $1 ORDER BY created_at DESC',
      [projectId]
    );

    // Recent activity: tasks updated in last 7 days, limit 10
    const recentActivityResult = await pool.query(`
      SELECT * FROM tasks
      WHERE project_id = $1 AND updated_at >= NOW() - INTERVAL '7 days'
      ORDER BY updated_at DESC
      LIMIT 10
    `, [projectId]);

    res.json({
      project,
      stats,
      health,
      goals: goalsResult.rows,
      features: featuresResult.rows,
      recent_activity: recentActivityResult.rows
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get project dashboard', details: err.message });
  }
});

export default router;
