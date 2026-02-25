import { Router } from 'express';
import pool from './db.js';

const router = Router();

// GET /api/goals - List goals
router.get('/', async (req, res) => {
  try {
    const { project_id, scope, business_id, department_id, area_id } = req.query;

    // 直接查询 goals 表（businesses/departments 表不存在）
    let query = `SELECT g.* FROM goals g`;
    let params = [];
    let conditions = [];
    let paramIndex = 1;

    if (project_id) {
      conditions.push(`g.project_id = $${paramIndex++}`);
      params.push(project_id);
    }
    if (scope) {
      conditions.push(`g.scope = $${paramIndex++}`);
      params.push(scope);
    }
    if (business_id) {
      conditions.push(`g.business_id = $${paramIndex++}`);
      params.push(business_id);
    }
    if (department_id) {
      conditions.push(`g.department_id = $${paramIndex++}`);
      params.push(department_id);
    }
    if (area_id) {
      conditions.push(`g.area_id = $${paramIndex++}`);
      params.push(area_id);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY g.created_at DESC';

    const result = await pool.query(query, params);

    // 保留 business/department 为 null（表不存在，无法 JOIN）
    const goals = result.rows.map(row => ({
      ...row,
      business: null,
      department: null,
    }));

    res.json(goals);
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

// POST /api/goals - Create goal (Objective or Key Result)
router.post('/', async (req, res) => {
  try {
    const {
      project_id, title, description, status, priority, target_date, progress, metadata, parent_id, type, weight,
      scope, cycle, business_id, department_id, area_id,
      expected_start_date, expected_end_date, actual_start_date, actual_end_date,
      custom_props
    } = req.body;

    // Determine type based on parent_id if not explicitly set
    const goalType = type || (parent_id ? 'key_result' : 'objective');

    // Note: OKR 三层架构允许跨层级 parent_id，所以移除严格的验证
    // 个人 KR 可以有业务 O 作为子级 (通过 parent_id 连接)

    const result = await pool.query(
      `INSERT INTO goals (
        project_id, title, description, status, priority, target_date, progress, metadata, parent_id, type, weight,
        scope, cycle, business_id, department_id, area_id,
        expected_start_date, expected_end_date, actual_start_date, actual_end_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) RETURNING *`,
      [
        project_id || null, title, description || null, status || 'pending', priority || 'P2',
        target_date || null, progress || 0, metadata || {}, parent_id || null, goalType, weight || 1.0,
        scope || null, cycle || null, business_id || null, department_id || null, area_id || null,
        expected_start_date || null, expected_end_date || null, actual_start_date || null, actual_end_date || null
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create goal', details: err.message });
  }
});

// Helper function to recalculate parent Objective progress from its Key Results
async function recalculateParentProgress(parentId) {
  if (!parentId) return;

  // Get all Key Results for this Objective
  const krsResult = await pool.query(
    'SELECT progress, weight FROM goals WHERE parent_id = $1 AND type = $2',
    [parentId, 'key_result']
  );

  if (krsResult.rows.length === 0) return;

  // Calculate weighted average: O.progress = Σ(KR.progress × KR.weight) / Σ(KR.weight)
  let totalWeightedProgress = 0;
  let totalWeight = 0;

  for (const kr of krsResult.rows) {
    const krWeight = parseFloat(kr.weight) || 1.0;
    const krProgress = parseInt(kr.progress) || 0;
    totalWeightedProgress += krProgress * krWeight;
    totalWeight += krWeight;
  }

  const newProgress = totalWeight > 0 ? Math.round(totalWeightedProgress / totalWeight) : 0;

  // Update parent Objective progress
  await pool.query(
    'UPDATE goals SET progress = $1, updated_at = NOW() WHERE id = $2',
    [newProgress, parentId]
  );
}

// PATCH /api/goals/:id - Update goal
router.patch('/:id', async (req, res) => {
  try {
    const {
      title, description, status, priority, target_date, progress, metadata, weight,
      scope, cycle, business_id, department_id, area_id,
      expected_start_date, expected_end_date, actual_start_date, actual_end_date,
      custom_props
    } = req.body;

    const updates = [];
    const params = [];
    let paramIndex = 1;

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
    }
    if (priority !== undefined) {
      updates.push('priority = $' + paramIndex++);
      params.push(priority);
    }
    if (target_date !== undefined) {
      updates.push('target_date = $' + paramIndex++);
      params.push(target_date);
    }
    if (progress !== undefined) {
      updates.push('progress = $' + paramIndex++);
      params.push(progress);
    }
    if (metadata !== undefined) {
      updates.push('metadata = $' + paramIndex++);
      params.push(metadata);
    }
    if (weight !== undefined) {
      updates.push('weight = $' + paramIndex++);
      params.push(weight);
    }
    if (scope !== undefined) {
      updates.push('scope = $' + paramIndex++);
      params.push(scope);
    }
    if (cycle !== undefined) {
      updates.push('cycle = $' + paramIndex++);
      params.push(cycle);
    }
    if (business_id !== undefined) {
      updates.push('business_id = $' + paramIndex++);
      params.push(business_id);
    }
    if (department_id !== undefined) {
      updates.push('department_id = $' + paramIndex++);
      params.push(department_id);
    }
    if (area_id !== undefined) {
      updates.push('area_id = $' + paramIndex++);
      params.push(area_id);
    }
    if (expected_start_date !== undefined) {
      updates.push('expected_start_date = $' + paramIndex++);
      params.push(expected_start_date);
    }
    if (expected_end_date !== undefined) {
      updates.push('expected_end_date = $' + paramIndex++);
      params.push(expected_end_date);
    }
    if (actual_start_date !== undefined) {
      updates.push('actual_start_date = $' + paramIndex++);
      params.push(actual_start_date);
    }
    if (actual_end_date !== undefined) {
      updates.push('actual_end_date = $' + paramIndex++);
      params.push(actual_end_date);
    }
    if (custom_props !== undefined) {
      updates.push('custom_props = custom_props || $' + paramIndex++);
      params.push(JSON.stringify(custom_props));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'At least one field must be provided for update' });
    }

    updates.push('updated_at = NOW()');
    params.push(req.params.id);

    const query = 'UPDATE goals SET ' + updates.join(', ') + ' WHERE id = $' + paramIndex + ' RETURNING *';
    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    const updatedGoal = result.rows[0];

    // If this is a Key Result and progress or weight was updated, recalculate parent Objective progress
    if (updatedGoal.type === 'key_result' && updatedGoal.parent_id && (progress !== undefined || weight !== undefined)) {
      await recalculateParentProgress(updatedGoal.parent_id);
    }

    res.json(updatedGoal);
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

// GET /api/goals/:id/children - Get Key Results for an Objective
router.get('/:id/children', async (req, res) => {
  try {
    // First verify the parent exists and is an Objective
    const parentResult = await pool.query('SELECT * FROM goals WHERE id = $1', [req.params.id]);

    if (parentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    const parent = parentResult.rows[0];
    if (parent.type !== 'objective') {
      return res.status(400).json({ error: 'Only Objectives can have children (Key Results)' });
    }

    // Get all Key Results for this Objective
    const result = await pool.query(
      'SELECT * FROM goals WHERE parent_id = $1 ORDER BY weight DESC, created_at ASC',
      [req.params.id]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list children', details: err.message });
  }
});

export default router;
