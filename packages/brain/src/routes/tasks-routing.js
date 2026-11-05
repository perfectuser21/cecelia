import { rateLimit } from 'express-rate-limit';
import { TASK_MUTATION_RATE_LIMIT_OPTIONS } from './task-mutation-rate-limit.js';
import pool from '../db.js';
import { routeTask } from '../tick-helpers.js';
import { identifyWorkType, routeTaskCreate, getValidTaskTypes, LOCATION_MAP, diagnoseKR } from '../task-router.js';

export function registerTaskRoutingRoutes(router) {


/**
 * POST /api/brain/route-task
 * Get agent routing for a task
 */
router.post('/route-task', rateLimit(TASK_MUTATION_RATE_LIMIT_OPTIONS), async (req, res) => {
  try {
    const { task_id, task_type } = req.body;

    let task;
    if (task_id) {
      const result = await pool.query('SELECT * FROM tasks WHERE id = $1', [task_id]);
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Task not found' });
      }
      task = result.rows[0];
    } else if (task_type) {
      task = { task_type };
    } else {
      return res.status(400).json({ success: false, error: 'task_id or task_type is required' });
    }

    const agent = routeTask(task);

    res.json({
      success: true,
      task_type: task.task_type || 'dev',
      agent,
      requires_manual: agent === null
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to route task', details: err.message });
  }
});


// ==================== Task Router API ====================

/**
 * POST /api/brain/identify-work-type
 * Identify if input is a single task or initiative
 */
router.post('/identify-work-type', (req, res) => {
  try {
    const { input } = req.body;

    if (!input) {
      return res.status(400).json({ success: false, error: 'input is required' });
    }

    const workType = identifyWorkType(input);
    res.json({ success: true, input, work_type: workType });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to identify work type', details: err.message });
  }
});


/**
 * GET /api/brain/task-locations
 * Get location mapping for all task types
 */
router.get('/task-locations', (req, res) => {
  res.json({
    success: true,
    locations: LOCATION_MAP,
    valid_task_types: getValidTaskTypes(),
    description: {
      us: '美国 VPS - Claude (开发、审查)',
      hk: '香港 VPS - MiniMax (自动化、数据处理)'
    }
  });
});


/**
 * POST /api/brain/route-task-create
 * Get routing decision for creating a task
 */
router.post('/route-task-create', (req, res) => {
  try {
    const { title, task_type, initiative_id, feature_id, is_recurring } = req.body;

    if (!title && !task_type) {
      return res.status(400).json({ success: false, error: 'title or task_type is required' });
    }

    const routing = routeTaskCreate({ title, task_type, feature_id: initiative_id || feature_id, is_recurring });
    res.json({ success: true, ...routing });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to route task create', details: err.message });
  }
});


/**
 * GET /api/brain/task-router/diagnose/:kr_id
 * Diagnose task dispatch status for a specific KR
 *
 * Returns a detailed diagnosis:
 * - KR info (title, status, priority, progress)
 * - All Projects → Initiatives → Tasks hierarchy
 * - Dispatch blockers (reasons why tasks are not being queued/dispatched)
 * - Per-initiative task counts and recent task list with routing info
 */
router.get('/task-router/diagnose/:kr_id', async (req, res) => {
  try {
    const { kr_id } = req.params;

    if (!kr_id) {
      return res.status(400).json({ success: false, error: 'kr_id is required' });
    }

    const diagnosis = await diagnoseKR(kr_id, pool);

    if (!diagnosis) {
      return res.status(404).json({ success: false, error: `KR not found: ${kr_id}` });
    }

    res.json({ success: true, ...diagnosis });
  } catch (err) {
    console.error(`[task-router/diagnose] error: ${err.message}`);
    res.status(500).json({ success: false, error: 'Failed to diagnose KR', details: err.message });
  }
});


// ==================== Reflections API ====================

/**
 * GET /api/brain/reflections
 * Get reflections (issues, learnings, improvements)
 */
router.get('/reflections', rateLimit(TASK_MUTATION_RATE_LIMIT_OPTIONS), async (req, res) => {
  try {
    const { type, project_id, limit = 50 } = req.query;

    let query = `
      SELECT r.*, NULL::text as project_name
      FROM reflections r
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (type) {
      query += ` AND r.type = $${paramIndex++}`;
      params.push(type);
    }

    if (project_id) {
      query += ` AND r.project_id = $${paramIndex++}`;
      params.push(project_id);
    }

    query += ` ORDER BY r.created_at DESC LIMIT $${paramIndex}`;
    params.push(parseInt(limit));

    const result = await pool.query(query, params);
    res.json({ success: true, reflections: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to get reflections', details: err.message });
  }
});


/**
 * POST /api/brain/reflections
 * Create a new reflection
 */
router.post('/reflections', rateLimit(TASK_MUTATION_RATE_LIMIT_OPTIONS), async (req, res) => {
  try {
    const { type, title, content, project_id, source_task_id, source_goal_id, tags } = req.body;

    if (!type || !title) {
      return res.status(400).json({ success: false, error: 'type and title are required' });
    }

    const validTypes = ['issue', 'learning', 'improvement'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ success: false, error: `type must be one of: ${validTypes.join(', ')}` });
    }

    const result = await pool.query(`
      INSERT INTO reflections (type, title, content, project_id, source_task_id, source_goal_id, tags)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [type, title, content, project_id, source_task_id, source_goal_id, tags]);

    res.json({ success: true, reflection: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to create reflection', details: err.message });
  }
});
}
