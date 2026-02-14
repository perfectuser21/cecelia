/**
 * Priority Engine - Daily Focus Selection
 * Implements the "today's focus" selection logic for Brain
 */

import pool from './db.js';

// Working memory key for manual focus override
const FOCUS_OVERRIDE_KEY = 'daily_focus_override';

/**
 * Select daily focus using priority algorithm
 * Priority rules:
 * 1. Manually pinned Objective (is_pinned = true)
 * 2. Higher priority (P0 > P1 > P2)
 * 3. Near completion (80%+ progress - prioritize finishing)
 * 4. Recently active (most recent updated_at)
 */
async function selectDailyFocus() {
  // Check for manual override first
  const overrideResult = await pool.query(
    'SELECT value_json FROM working_memory WHERE key = $1',
    [FOCUS_OVERRIDE_KEY]
  );

  if (overrideResult.rows.length > 0 && overrideResult.rows[0].value_json?.objective_id) {
    const manualObjectiveId = overrideResult.rows[0].value_json.objective_id;

    // Fetch the manually set objective
    const objResult = await pool.query(
      'SELECT * FROM goals WHERE id = $1 AND type = $2',
      [manualObjectiveId, 'objective']
    );

    if (objResult.rows.length > 0) {
      return {
        objective: objResult.rows[0],
        reason: '手动设置的焦点',
        is_manual: true
      };
    }
  }

  // Auto-select using algorithm
  const result = await pool.query(`
    SELECT *
    FROM goals
    WHERE type IN ('global_okr', 'area_okr')
      AND status NOT IN ('completed', 'cancelled')
    ORDER BY
      -- 1. Pinned first
      CASE WHEN (metadata->>'is_pinned')::boolean = true THEN 0 ELSE 1 END,
      -- 2. Priority order (P0 > P1 > P2)
      CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
      -- 3. Near completion (80%+) gets priority boost
      CASE WHEN progress >= 80 THEN 0 ELSE 1 END,
      -- 4. Recently active
      updated_at DESC NULLS LAST
    LIMIT 1
  `);

  if (result.rows.length === 0) {
    return null;
  }

  const objective = result.rows[0];

  // Generate reason
  const reason = generateReason(objective);

  return {
    objective,
    reason,
    is_manual: false
  };
}

/**
 * Generate human-readable reason for focus selection
 */
function generateReason(objective) {
  const reasons = [];

  if (objective.metadata?.is_pinned) {
    reasons.push('已置顶');
  }

  if (objective.priority === 'P0') {
    reasons.push('P0 最高优先级');
  } else if (objective.priority === 'P1') {
    reasons.push('P1 高优先级');
  }

  if (objective.progress >= 80) {
    reasons.push(`进度 ${objective.progress}%，接近完成`);
  } else if (objective.progress > 0) {
    reasons.push(`当前进度 ${objective.progress}%`);
  }

  if (reasons.length === 0) {
    reasons.push('最近有活动');
  }

  return reasons.join('，');
}

/**
 * Get daily focus with full details
 */
async function getDailyFocus() {
  const focusResult = await selectDailyFocus();

  if (!focusResult) {
    return null;
  }

  const { objective, reason, is_manual } = focusResult;

  // Get ALL Key Results recursively (including nested KRs)
  // Using recursive CTE to get full hierarchy
  const krsResult = await pool.query(`
    WITH RECURSIVE kr_tree AS (
      -- Base: direct children of objective
      SELECT * FROM goals WHERE parent_id = $1
      UNION ALL
      -- Recursive: children of KRs
      SELECT g.* FROM goals g
      INNER JOIN kr_tree kt ON g.parent_id = kt.id
    )
    SELECT * FROM kr_tree ORDER BY created_at ASC
  `, [objective.id]);

  // Get suggested tasks (tasks linked to this objective or ANY level KRs)
  const krIds = krsResult.rows.map(kr => kr.id);
  const allGoalIds = [objective.id, ...krIds];

  let suggestedTasks = [];
  if (allGoalIds.length > 0) {
    const tasksResult = await pool.query(`
      SELECT id, title, status, priority
      FROM tasks
      WHERE goal_id = ANY($1)
        AND status NOT IN ('completed', 'cancelled')
      ORDER BY
        CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
        created_at ASC
      LIMIT 5
    `, [allGoalIds]);
    suggestedTasks = tasksResult.rows;
  }

  return {
    focus: {
      objective: {
        id: objective.id,
        title: objective.title,
        description: objective.description,
        priority: objective.priority,
        progress: objective.progress,
        status: objective.status
      },
      key_results: krsResult.rows.map(kr => ({
        id: kr.id,
        title: kr.title,
        progress: kr.progress,
        weight: kr.weight,
        status: kr.status
      })),
      suggested_tasks: suggestedTasks
    },
    reason,
    is_manual
  };
}

/**
 * Manually set daily focus (override algorithm)
 */
async function setDailyFocus(objectiveId) {
  // Verify objective exists
  const objResult = await pool.query(
    'SELECT id FROM goals WHERE id = $1 AND type = $2',
    [objectiveId, 'objective']
  );

  if (objResult.rows.length === 0) {
    throw new Error('Objective not found');
  }

  // Store override in working memory
  await pool.query(`
    INSERT INTO working_memory (key, value_json, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
  `, [FOCUS_OVERRIDE_KEY, { objective_id: objectiveId }]);

  return { success: true, objective_id: objectiveId };
}

/**
 * Clear manual focus override, restore auto-selection
 */
async function clearDailyFocus() {
  await pool.query(
    'DELETE FROM working_memory WHERE key = $1',
    [FOCUS_OVERRIDE_KEY]
  );

  return { success: true };
}

/**
 * Get focus summary for Decision Pack
 */
async function getFocusSummary() {
  const focusResult = await selectDailyFocus();

  if (!focusResult) {
    return null;
  }

  const { objective, reason, is_manual } = focusResult;

  // Get Key Results for this Objective (top 3, any level)
  const krsResult = await pool.query(`
    WITH RECURSIVE kr_tree AS (
      SELECT * FROM goals WHERE parent_id = $1
      UNION ALL
      SELECT g.* FROM goals g
      INNER JOIN kr_tree kt ON g.parent_id = kt.id
    )
    SELECT id, title, progress FROM kr_tree ORDER BY weight DESC NULLS LAST LIMIT 3
  `, [objective.id]);

  return {
    objective_id: objective.id,
    objective_title: objective.title,
    priority: objective.priority,
    progress: objective.progress,
    key_results: krsResult.rows,
    reason,
    is_manual
  };
}

export {
  getDailyFocus,
  setDailyFocus,
  clearDailyFocus,
  getFocusSummary,
  selectDailyFocus
};
