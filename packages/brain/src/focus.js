/**
 * Focus Engine - OKR 统一版 (v2.0)
 *
 * Focus = ready 状态的 KR 列表。
 * 不再有自动选择算法 — 用户通过标记 KR 为 ready 来决定焦点。
 *
 * 保留手动覆盖机制（setDailyFocus）用于兼容。
 */

import pool from './db.js';

const FOCUS_OVERRIDE_KEY = 'daily_focus_override';

/**
 * 获取所有 ready 状态的 KR（即用户已放行的 KR）。
 * 这些就是系统当前的焦点。
 */
async function getReadyKRs() {
  const result = await pool.query(`
    SELECT id, title, description, priority, progress, status, parent_id
    FROM goals
    WHERE type = 'kr'
      AND status IN ('ready', 'in_progress')
    ORDER BY
      CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
      created_at ASC
  `);
  return result.rows;
}

/**
 * Select daily focus — 基于 ready KR 的父 Area 选择。
 * 如果有手动覆盖，优先使用手动设置。
 * 否则选 ready KR 最多的 Area OKR 作为焦点。
 */
async function selectDailyFocus() {
  // Check for manual override first
  const overrideResult = await pool.query(
    'SELECT value_json FROM working_memory WHERE key = $1',
    [FOCUS_OVERRIDE_KEY]
  );

  if (overrideResult.rows.length > 0 && overrideResult.rows[0].value_json?.objective_id) {
    const manualObjectiveId = overrideResult.rows[0].value_json.objective_id;
    const objResult = await pool.query(
      'SELECT * FROM goals WHERE id = $1 AND type IN ($2, $3)',
      [manualObjectiveId, 'global_okr', 'area_okr']
    );

    if (objResult.rows.length > 0) {
      return {
        objective: objResult.rows[0],
        reason: '手动设置的焦点',
        is_manual: true
      };
    }
  }

  // 基于 ready KR 选择焦点 Area
  const readyKRs = await getReadyKRs();

  if (readyKRs.length === 0) {
    return null;
  }

  // 统计每个 Area 下有多少 ready KR
  const areaCount = {};
  for (const kr of readyKRs) {
    if (kr.parent_id) {
      areaCount[kr.parent_id] = (areaCount[kr.parent_id] || 0) + 1;
    }
  }

  // 选 ready KR 最多的 Area
  const bestAreaId = Object.entries(areaCount)
    .sort(([, a], [, b]) => b - a)[0]?.[0];

  if (!bestAreaId) {
    return null;
  }

  const areaResult = await pool.query(
    'SELECT * FROM goals WHERE id = $1',
    [bestAreaId]
  );

  if (areaResult.rows.length === 0) {
    return null;
  }

  const objective = areaResult.rows[0];
  const krCount = areaCount[bestAreaId];

  return {
    objective,
    reason: `${krCount} 个 ready KR`,
    is_manual: false
  };
}

/**
 * Get daily focus with full details (兼容旧接口)
 */
async function getDailyFocus() {
  const focusResult = await selectDailyFocus();

  if (!focusResult) {
    return null;
  }

  const { objective, reason, is_manual } = focusResult;

  // Get ready KRs under this objective
  const readyKRs = await pool.query(`
    SELECT id, title, progress, weight, status
    FROM goals
    WHERE parent_id = $1
      AND status IN ('ready', 'in_progress')
    ORDER BY
      CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END,
      created_at ASC
  `, [objective.id]);

  // Get suggested tasks (tasks under ready KRs)
  const krIds = readyKRs.rows.map(kr => kr.id);
  let suggestedTasks = [];
  if (krIds.length > 0) {
    const tasksResult = await pool.query(`
      SELECT id, title, status, priority
      FROM tasks
      WHERE goal_id = ANY($1)
        AND status NOT IN ('completed', 'cancelled')
      ORDER BY
        CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
        created_at ASC
      LIMIT 5
    `, [krIds]);
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
      key_results: readyKRs.rows,
      suggested_tasks: suggestedTasks
    },
    reason,
    is_manual
  };
}

/**
 * Manually set daily focus (override)
 */
async function setDailyFocus(objectiveId) {
  const objResult = await pool.query(
    'SELECT id FROM goals WHERE id = $1 AND type IN ($2, $3)',
    [objectiveId, 'global_okr', 'area_okr']
  );

  if (objResult.rows.length === 0) {
    throw new Error('Objective not found');
  }

  await pool.query(`
    INSERT INTO working_memory (key, value_json, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
  `, [FOCUS_OVERRIDE_KEY, { objective_id: objectiveId }]);

  return { success: true, objective_id: objectiveId };
}

/**
 * Clear manual focus override
 */
async function clearDailyFocus() {
  await pool.query(
    'DELETE FROM working_memory WHERE key = $1',
    [FOCUS_OVERRIDE_KEY]
  );
  return { success: true };
}

/**
 * Get focus summary (兼容旧接口)
 */
async function getFocusSummary() {
  const focusResult = await selectDailyFocus();
  if (!focusResult) return null;

  const { objective, reason, is_manual } = focusResult;

  const krsResult = await pool.query(`
    SELECT id, title, progress
    FROM goals
    WHERE parent_id = $1 AND status IN ('ready', 'in_progress')
    ORDER BY
      CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END
    LIMIT 3
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
  selectDailyFocus,
  getReadyKRs,
};
