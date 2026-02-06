/**
 * Planner Agent - Brain's planning layer
 *
 * Dynamic planning loop: each tick selects the best KR → Project → Task to advance.
 * V1: dispatches existing queued tasks; flags when manual planning is needed.
 */

import pool from './db.js';
import { getDailyFocus } from './focus.js';

/**
 * Get global state for planning decisions
 */
async function getGlobalState() {
  const [objectives, keyResults, projects, activeTasks, recentCompleted, focusResult] = await Promise.all([
    pool.query(`
      SELECT * FROM goals
      WHERE type = 'objective' AND status NOT IN ('completed', 'cancelled')
      ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END
    `),
    pool.query(`
      SELECT * FROM goals
      WHERE type = 'key_result' AND status NOT IN ('completed', 'cancelled')
      ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END
    `),
    pool.query(`SELECT * FROM projects WHERE status = 'active'`),
    pool.query(`SELECT * FROM tasks WHERE status IN ('queued', 'in_progress') ORDER BY created_at ASC`),
    pool.query(`SELECT * FROM tasks WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 10`),
    getDailyFocus()
  ]);

  return {
    objectives: objectives.rows,
    keyResults: keyResults.rows,
    projects: projects.rows,
    activeTasks: activeTasks.rows,
    recentCompleted: recentCompleted.rows,
    focus: focusResult
  };
}

/**
 * Score and sort KRs by priority/progress/focus.
 */
function scoreKRs(state) {
  const { keyResults, activeTasks, focus } = state;
  if (keyResults.length === 0) return [];

  const focusKRIds = new Set(
    focus?.focus?.key_results?.map(kr => kr.id) || []
  );

  const queuedByGoal = {};
  for (const t of activeTasks) {
    if (t.status === 'queued' && t.goal_id) {
      queuedByGoal[t.goal_id] = (queuedByGoal[t.goal_id] || 0) + 1;
    }
  }

  const scored = keyResults.map(kr => {
    let score = 0;
    if (focusKRIds.has(kr.id)) score += 100;
    if (kr.priority === 'P0') score += 30;
    else if (kr.priority === 'P1') score += 20;
    else if (kr.priority === 'P2') score += 10;
    score += (100 - (kr.progress || 0)) * 0.2;
    if (kr.target_date) {
      const daysLeft = (new Date(kr.target_date) - Date.now()) / (1000 * 60 * 60 * 24);
      if (daysLeft > 0 && daysLeft < 14) score += 20;
      if (daysLeft > 0 && daysLeft < 7) score += 20;
    }
    if (queuedByGoal[kr.id]) score += 15;
    return { kr, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Select the KR most in need of advancement.
 */
function selectTargetKR(state) {
  const scored = scoreKRs(state);
  return scored[0]?.kr || null;
}

/**
 * Select the Project most in need of advancement for a given KR.
 */
async function selectTargetProject(kr, state) {
  const { projects, activeTasks } = state;

  const linksResult = await pool.query(
    'SELECT project_id FROM project_kr_links WHERE kr_id = $1',
    [kr.id]
  );
  const linkedProjectIds = new Set(linksResult.rows.map(r => r.project_id));

  if (kr.project_id) linkedProjectIds.add(kr.project_id);

  for (const t of activeTasks) {
    if (t.goal_id === kr.id && t.project_id) linkedProjectIds.add(t.project_id);
  }

  if (linkedProjectIds.size === 0) return null;

  const candidateProjects = projects.filter(p => linkedProjectIds.has(p.id));
  if (candidateProjects.length === 0) return null;

  const queuedByProject = {};
  for (const t of activeTasks) {
    if (t.status === 'queued' && t.project_id) {
      queuedByProject[t.project_id] = (queuedByProject[t.project_id] || 0) + 1;
    }
  }

  const scored = candidateProjects.map(p => {
    let score = 0;
    if (queuedByProject[p.id]) score += 50;
    if (p.repo_path) score += 20;
    return { project: p, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.project || null;
}

/**
 * Generate the next task for a given KR + Project.
 * V2: returns existing queued task, or auto-generates a new one based on KR gap.
 *
 * @param {Object} kr - Target Key Result
 * @param {Object} project - Target Project
 * @param {Object} state - Global planning state
 * @param {Object} [options] - Options
 * @param {boolean} [options.dryRun=false] - If true, don't write to DB
 * @returns {Object|null} - Task or null
 */
async function generateNextTask(kr, project, state, options = {}) {
  // V1: check existing queued or in_progress tasks first — don't generate if work exists
  const result = await pool.query(`
    SELECT * FROM tasks
    WHERE project_id = $1 AND goal_id = $2 AND status IN ('queued', 'in_progress')
    ORDER BY
      CASE status WHEN 'queued' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
      CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
      created_at ASC
    LIMIT 1
  `, [project.id, kr.id]);

  if (result.rows[0]) return result.rows[0];

  // No existing task — return null. Task creation is 秋米's responsibility via /okr.
  return null;
}

// autoGenerateTask, KR_STRATEGIES, getFallbackTasks, generateTaskFromKR, generateTaskPRD
// — all removed. Task creation is now 秋米's responsibility via /okr skill.


/**
 * Main entry point - called each tick.
 * Iterates through all scored KRs until one produces a task.
 */
async function planNextTask(scopeKRIds = null) {
  const state = await getGlobalState();

  // If scoped to specific KRs (from tick focus), filter keyResults before selecting
  if (scopeKRIds && scopeKRIds.length > 0) {
    const scopeSet = new Set(scopeKRIds);
    state.keyResults = state.keyResults.filter(kr => scopeSet.has(kr.id));
  }

  if (state.keyResults.length === 0) {
    return { planned: false, reason: 'no_active_kr' };
  }

  // Score and sort all KRs, then try each in order
  const scored = scoreKRs(state);

  let lastKR = null;
  let lastProject = null;

  for (const { kr } of scored) {
    lastKR = kr;

    const targetProject = await selectTargetProject(kr, state);
    if (!targetProject) continue;
    lastProject = targetProject;

    const task = await generateNextTask(kr, targetProject, state);
    if (task) {
      return {
        planned: true,
        task: { id: task.id, title: task.title, priority: task.priority, project_id: task.project_id, goal_id: task.goal_id },
        kr: { id: kr.id, title: kr.title },
        project: { id: targetProject.id, title: targetProject.name, repo_path: targetProject.repo_path }
      };
    }
  }

  // All KRs exhausted
  return {
    planned: false,
    reason: lastProject ? 'needs_planning' : 'no_project_for_kr',
    kr: lastKR ? { id: lastKR.id, title: lastKR.title } : null,
    project: lastProject ? { id: lastProject.id, title: lastProject.name, repo_path: lastProject.repo_path } : null
  };
}

/**
 * Get current planning status
 */
async function getPlanStatus() {
  const state = await getGlobalState();
  const targetKR = selectTargetKR(state);

  let targetProject = null;
  let queuedTasks = [];
  let lastCompleted = null;

  if (targetKR) {
    targetProject = await selectTargetProject(targetKR, state);

    const queuedResult = await pool.query(`
      SELECT id, title, priority, project_id, status FROM tasks
      WHERE goal_id = $1 AND status = 'queued'
      ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END
    `, [targetKR.id]);
    queuedTasks = queuedResult.rows;

    const completedResult = await pool.query(`
      SELECT id, title, completed_at FROM tasks
      WHERE goal_id = $1 AND status = 'completed'
      ORDER BY completed_at DESC LIMIT 1
    `, [targetKR.id]);
    lastCompleted = completedResult.rows[0] || null;
  }

  return {
    target_kr: targetKR ? { id: targetKR.id, title: targetKR.title, progress: targetKR.progress, priority: targetKR.priority } : null,
    target_project: targetProject ? { id: targetProject.id, title: targetProject.name, repo_path: targetProject.repo_path } : null,
    queued_tasks: queuedTasks,
    last_completed: lastCompleted
  };
}

/**
 * Handle plan input - create resources at the correct level.
 * Enforces all 5 hard constraints.
 */
async function handlePlanInput(input, dryRun = false) {
  const result = {
    level: null,
    action: 'create',
    created: { goals: [], projects: [], tasks: [] },
    linked_to: { kr: null, project: null }
  };

  if (input.objective) {
    result.level = 'objective';
    if (!dryRun) {
      const oResult = await pool.query(`
        INSERT INTO goals (title, description, priority, type, status, progress)
        VALUES ($1, $2, $3, 'objective', 'pending', 0) RETURNING *
      `, [input.objective.title, input.objective.description || '', input.objective.priority || 'P1']);
      result.created.goals.push(oResult.rows[0]);

      if (Array.isArray(input.objective.key_results)) {
        for (const krInput of input.objective.key_results) {
          const krResult = await pool.query(`
            INSERT INTO goals (title, description, priority, type, parent_id, weight, status, progress, metadata)
            VALUES ($1, $2, $3, 'key_result', $4, $5, 'pending', 0, $6) RETURNING *
          `, [
            krInput.title, krInput.description || '', krInput.priority || input.objective.priority || 'P1',
            oResult.rows[0].id, krInput.weight || 1.0,
            JSON.stringify({ metric: krInput.metric, target: krInput.target, deadline: krInput.deadline })
          ]);
          result.created.goals.push(krResult.rows[0]);
        }
      }
    }
  } else if (input.key_result) {
    result.level = 'kr';
    if (!dryRun) {
      const krResult = await pool.query(`
        INSERT INTO goals (title, description, priority, type, parent_id, weight, status, progress, metadata)
        VALUES ($1, $2, $3, 'key_result', $4, $5, 'pending', 0, $6) RETURNING *
      `, [
        input.key_result.title, input.key_result.description || '', input.key_result.priority || 'P1',
        input.key_result.objective_id || null, input.key_result.weight || 1.0,
        JSON.stringify({ metric: input.key_result.metric, target: input.key_result.target, deadline: input.key_result.deadline })
      ]);
      result.created.goals.push(krResult.rows[0]);
      result.linked_to.kr = krResult.rows[0];
    }
  } else if (input.project) {
    result.level = 'project';
    if (!input.project.repo_path) {
      throw new Error('Hard constraint: Project must have repo_path');
    }
    if (!dryRun) {
      const pResult = await pool.query(`
        INSERT INTO projects (name, description, repo_path, status)
        VALUES ($1, $2, $3, 'active') RETURNING *
      `, [input.project.title, input.project.description || '', input.project.repo_path]);
      result.created.projects.push(pResult.rows[0]);
      result.linked_to.project = pResult.rows[0];

      if (Array.isArray(input.project.kr_ids)) {
        for (const krId of input.project.kr_ids) {
          await pool.query(
            'INSERT INTO project_kr_links (project_id, kr_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [pResult.rows[0].id, krId]
          );
        }
      }
    }
  } else if (input.task) {
    result.level = 'task';
    if (!input.task.project_id) {
      throw new Error('Hard constraint: Task must have project_id');
    }
    if (!dryRun) {
      const projCheck = await pool.query('SELECT id, repo_path FROM projects WHERE id = $1', [input.task.project_id]);
      if (projCheck.rows.length === 0) throw new Error('Project not found');
      if (!projCheck.rows[0].repo_path) throw new Error('Hard constraint: Task\'s project must have repo_path');

      const tResult = await pool.query(`
        INSERT INTO tasks (title, description, priority, project_id, goal_id, status, payload)
        VALUES ($1, $2, $3, $4, $5, 'queued', $6) RETURNING *
      `, [
        input.task.title, input.task.description || '', input.task.priority || 'P1',
        input.task.project_id, input.task.goal_id || null,
        JSON.stringify(input.task.payload || {})
      ]);
      result.created.tasks.push(tResult.rows[0]);
    }
  } else {
    throw new Error('Input must contain one of: objective, key_result, project, task');
  }

  return result;
}

export {
  planNextTask,
  getPlanStatus,
  handlePlanInput,
  getGlobalState,
  scoreKRs,
  selectTargetKR,
  selectTargetProject,
  generateNextTask
};
