/**
 * Planner Agent - Brain's planning layer
 *
 * Dynamic planning loop: each tick selects the best KR → Project → Task to advance.
 * V1: dispatches existing queued tasks; flags when manual planning is needed.
 */

import pool from './db.js';
import { getDailyFocus } from './focus.js';

// Learning penalty configuration
const LEARNING_PENALTY_SCORE = -20;       // 惩罚分数（可配置）
const LEARNING_LOOKBACK_DAYS = 7;         // 回溯天数（可配置）
const LEARNING_FAILURE_THRESHOLD = 2;     // 触发惩罚的最低失败次数（可配置）

// Insight adjustment configuration（反刍/皮层洞察对 KR 得分的影响）
const INSIGHT_LOOKBACK_DAYS = 7;
const INSIGHT_SUCCESS_BONUS = 5;      // 成功模式 → 优先推进
const INSIGHT_WARNING_PENALTY = -8;   // 皮层警告 → 谨慎
const INSIGHT_FAILURE_PENALTY = -10;  // 失败模式（已处理但值得关注）→ 减速

// Content-aware score configuration
const CONTENT_SCORE_KNOWN_DECOMPOSITION_BONUS = 5;   // 已知方案 dev task 优先

// Area Stream configuration
// 同时活跃的 Area OKR 数量（流的数量），支持环境变量覆盖
const ACTIVE_AREA_COUNT = parseInt(process.env.ACTIVE_AREA_COUNT || '3', 10);

/**
 * Build a map of task_type → penalty score based on recent learning failures.
 * Queries learnings table for failure_pattern entries in the past LEARNING_LOOKBACK_DAYS
 * that are associated with the given project, grouped by task_type.
 *
 * @param {string} projectId - Project ID to scope learnings query
 * @returns {Promise<Map<string, number>>} - Map of task_type → penalty score (negative)
 */
async function buildLearningPenaltyMap(projectId) {
  try {
    const cutoff = new Date(Date.now() - LEARNING_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    // Query learnings for this project in the lookback window, grouped by task_type
    // task_type is stored in metadata JSONB field
    const result = await pool.query(`
      SELECT metadata->>'task_type' AS task_type, COUNT(*) AS failure_count
      FROM learnings
      WHERE category = 'failure_pattern'
        AND created_at >= $1
        AND (
          metadata->>'project_id' = $2::text
          OR metadata->>'task_id' IN (
            SELECT id::text FROM tasks WHERE project_id = $2::uuid
          )
        )
      GROUP BY metadata->>'task_type'
      HAVING COUNT(*) >= $3
    `, [cutoff, projectId, LEARNING_FAILURE_THRESHOLD]);

    const penaltyMap = new Map();
    for (const row of result.rows) {
      if (row.task_type) {
        penaltyMap.set(row.task_type, LEARNING_PENALTY_SCORE);
      }
    }

    if (penaltyMap.size > 0) {
      console.log(`[planner] Learning penalty map for project ${projectId}: ${JSON.stringify(Object.fromEntries(penaltyMap))}`);
    }

    return penaltyMap;
  } catch (err) {
    // Graceful degradation: if learning query fails, return empty map (no penalty applied)
    console.error(`[planner] buildLearningPenaltyMap failed: ${err.message}`);
    return new Map();
  }
}

/**
 * Build a map of kr_id → score_adjustment based on recent rumination/cortex insights.
 *
 * 反刍闭环：将 rumination / cortex 洞察从"抽屉里"流回到 KR 选择权重。
 *
 * 查询规则：
 *   - category = 'success_pattern'   → INSIGHT_SUCCESS_BONUS（推进该 KR）
 *   - category = 'cortex_insight'    → INSIGHT_WARNING_PENALTY（谨慎）
 *   - category = 'failure_pattern'   → INSIGHT_FAILURE_PENALTY（已失败，减速）
 *   - metadata.kr_id 或 metadata.goal_id 存在 → 关联到具体 KR
 *   - 无 KR 关联的洞察 → 跳过（只影响有归属的 KR）
 *
 * @param {string[]} krIds - KR IDs to look up insights for
 * @returns {Promise<Map<string, number>>} - Map of kr_id → adjustment score
 */
export async function buildInsightAdjustments(krIds) {
  if (!krIds || krIds.length === 0) return new Map();

  try {
    const cutoff = new Date(Date.now() - INSIGHT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    const result = await pool.query(`
      SELECT
        COALESCE(metadata->>'kr_id', metadata->>'goal_id') AS kr_id,
        category,
        COUNT(*) AS cnt
      FROM learnings
      WHERE created_at >= $1
        AND category IN ('success_pattern', 'cortex_insight', 'failure_pattern', 'rumination')
        AND (
          metadata->>'kr_id' = ANY($2::text[])
          OR metadata->>'goal_id' = ANY($2::text[])
        )
      GROUP BY 1, 2
    `, [cutoff, krIds]);

    const adjustMap = new Map();
    for (const row of result.rows) {
      if (!row.kr_id) continue;
      const cnt = parseInt(row.cnt, 10);
      let adjustment = 0;
      if (row.category === 'success_pattern') {
        adjustment = INSIGHT_SUCCESS_BONUS * Math.min(cnt, 3); // 最多叠加 3 次
      } else if (row.category === 'cortex_insight') {
        adjustment = INSIGHT_WARNING_PENALTY;
      } else if (row.category === 'failure_pattern' || row.category === 'rumination') {
        adjustment = INSIGHT_FAILURE_PENALTY * Math.min(cnt, 2);
      }
      adjustMap.set(row.kr_id, (adjustMap.get(row.kr_id) || 0) + adjustment);
    }

    if (adjustMap.size > 0) {
      console.log(`[planner] Insight adjustments: ${JSON.stringify(Object.fromEntries(adjustMap))}`);
    }

    return adjustMap;
  } catch (err) {
    console.error(`[planner] buildInsightAdjustments failed: ${err.message}`);
    return new Map();
  }
}

/**
 * Apply content-aware score bonus to a list of tasks based on task_type and payload content.
 *
 * Scoring rules:
 *   - payload.decomposition_mode === 'known'   → +5  (已知方案优先)
 *
 * @param {Array} tasks - Array of task objects from DB
 * @returns {Array} - Same tasks, each augmented with _content_score_bonus field
 */
export function applyContentAwareScore(tasks) {
  const scored = tasks.map(task => {
    let bonus = 0;
    const payload = task.payload || {};

    if (payload.decomposition_mode === 'known') {
      bonus += CONTENT_SCORE_KNOWN_DECOMPOSITION_BONUS;
    }

    return { ...task, _content_score_bonus: bonus };
  });

  console.debug(`[planner] content-aware scores: ${JSON.stringify(scored.map(t => ({ id: t.id, task_type: t.task_type, bonus: t._content_score_bonus })))}`);

  return scored;
}

/**
 * Get global state for planning decisions
 */
async function getGlobalState() {
  const [objectives, keyResults, projects, activeTasks, recentCompleted, focusResult] = await Promise.all([
    pool.query(`
      SELECT * FROM goals
      WHERE type IN ('global_okr', 'area_okr') AND status NOT IN ('completed', 'cancelled')
      ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END
    `),
    pool.query(`
      SELECT * FROM goals
      WHERE type IN ('kr', 'global_kr', 'area_kr') AND status NOT IN ('completed', 'cancelled')
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
 *
 * @param {Object} state - Global planning state
 * @param {Map<string, number>} [insightAdjustments] - Optional kr_id → adjustment from rumination/cortex
 */
function scoreKRs(state, insightAdjustments = new Map()) {
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
    // 反刍/皮层洞察调整（方向3：反思闭环流回决策权重）
    const insightAdj = insightAdjustments.get(kr.id) || 0;
    if (insightAdj !== 0) score += insightAdj;
    return { kr, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Select the KR most in need of advancement.
 * @param {Object} state
 * @param {Map<string, number>} [insightAdjustments]
 */
function selectTargetKR(state, insightAdjustments = new Map()) {
  const scored = scoreKRs(state, insightAdjustments);
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
  // V4: Phase-aware task selection — dev tasks first.
  const result = await pool.query(`
    SELECT * FROM tasks
    WHERE project_id = $1 AND goal_id = $2 AND status IN ('queued', 'in_progress')
    ORDER BY
      CASE phase WHEN 'dev' THEN 0 ELSE 1 END,
      CASE status WHEN 'queued' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
      CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
      created_at ASC
  `, [project.id, kr.id]);

  if (result.rows.length === 0) {
    // No existing task — return null. Task creation is 秋米's responsibility via /okr.
    return null;
  }

  // V5: Apply learning penalty to sort tasks — penalize task types with recent failure patterns.
  // Build penalty map from learnings (gracefully degrades if query fails).
  const penaltyMap = await buildLearningPenaltyMap(project.id);

  // V6: Apply content-aware score bonus based on task_type and payload content.
  // Always applied (even when penaltyMap is empty) to enable content-aware ordering.
  const contentScoredTasks = applyContentAwareScore(result.rows);

  if (penaltyMap.size === 0) {
    // No learning penalties — re-sort with content-aware bonus only
    const reScored = contentScoredTasks.map(task => {
      let score = 0;

      // Phase score (dev first)
      if (task.phase === 'dev') score += 100;

      // Status score (queued before in_progress)
      if (task.status === 'queued') score += 10;

      // Priority score
      if (task.priority === 'P0') score += 30;
      else if (task.priority === 'P1') score += 20;
      else if (task.priority === 'P2') score += 10;

      // Content-aware bonus
      score += task._content_score_bonus;

      return { task, score };
    });

    reScored.sort((a, b) => b.score - a.score);
    return reScored[0].task;
  }

  // Re-score tasks with learning penalty + content-aware bonus applied
  const scored = contentScoredTasks.map(task => {
    let score = 0;

    // Phase score (dev first)
    if (task.phase === 'dev') score += 100;

    // Status score (queued before in_progress)
    if (task.status === 'queued') score += 10;

    // Priority score
    if (task.priority === 'P0') score += 30;
    else if (task.priority === 'P1') score += 20;
    else if (task.priority === 'P2') score += 10;

    // Apply learning penalty if this task_type has recent failures
    const penalty = penaltyMap.get(task.task_type) || 0;
    score += penalty;

    // Content-aware bonus
    score += task._content_score_bonus;

    return { task, score };
  });

  // Sort by score descending (highest score = highest priority)
  scored.sort((a, b) => b.score - a.score);

  return scored[0].task;
}

// autoGenerateTask, KR_STRATEGIES, getFallbackTasks, generateTaskFromKR, generateTaskPRD
// — all removed. Task creation is now 秋米's responsibility via /okr skill.


/**
 * =============================================================================
 * Area Stream Dispatch (流调度层)
 * =============================================================================
 * 基于 Area OKR 的流调度：每个活跃 Area 保底 1 个 slot，Initiative Lock。
 *
 * 调度链：Area OKR → KR（最优先）→ Initiative（Lock）→ Task
 *
 * 流的定义：
 * - 流 = 一个 Area OKR
 * - 流内部 Initiative Lock：有 in_progress 任务的 Initiative 优先继续
 * - 无 in_progress 时，选最早创建的有 queued 任务的 Initiative（FIFO）
 */

/**
 * 选出有任务的 top N 个 Area OKR，按优先级 + queued 数量排序。
 *
 * @param {Object} state - Global planning state (from getGlobalState)
 * @param {number} count - 最多返回几个 Area
 * @returns {Array} - Area OKR objects, sorted by score descending
 */
export function selectTopAreas(state, count) {
  const { objectives, keyResults, activeTasks } = state;

  const areas = objectives.filter(
    g => g.type === 'area_okr' && g.status !== 'completed' && g.status !== 'cancelled'
  );

  if (areas.length === 0) return [];

  // KR.parent_id → Area.id 的映射（只看 ready/in_progress 的 KR）
  const krToAreaId = {};
  for (const kr of keyResults) {
    if (kr.parent_id && (kr.status === 'ready' || kr.status === 'in_progress')) {
      krToAreaId[kr.id] = kr.parent_id;
    }
  }

  // 统计每个 Area 下的 queued 任务数
  const queuedByArea = {};
  for (const task of activeTasks) {
    if (task.status !== 'queued' || !task.goal_id) continue;
    const areaId = krToAreaId[task.goal_id];
    if (areaId) {
      queuedByArea[areaId] = (queuedByArea[areaId] || 0) + 1;
    }
  }

  // 只保留有 queued 任务的 Area
  const activeAreas = areas.filter(a => queuedByArea[a.id] > 0);
  if (activeAreas.length === 0) return [];

  // 打分：优先级 + queued 数量（上限 20，防止数量完全主导）
  const scored = activeAreas.map(area => {
    let score = 0;
    if (area.priority === 'P0') score += 30;
    else if (area.priority === 'P1') score += 20;
    else if (area.priority === 'P2') score += 10;
    score += Math.min(queuedByArea[area.id] || 0, 20);
    return { area, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, count).map(s => s.area);
}

/**
 * Initiative Lock：为指定 Area 选出当前应专注的 Initiative。
 *
 * 优先级：
 * 1. 有 in_progress 任务的 Initiative（Lock，继续跑完）
 * 2. 无 in_progress 时，最早创建的有 queued 任务的 Initiative（FIFO）
 *
 * @param {Object} area - Area OKR object
 * @param {Object} state - Global planning state
 * @returns {{ initiative: Object, kr: Object } | null}
 */
export function selectActiveInitiativeForArea(area, state) {
  const { keyResults, activeTasks, projects } = state;

  // 找出该 Area 下所有 KR 的 ID
  const areaKRIds = new Set(
    keyResults
      .filter(kr => kr.parent_id === area.id)
      .map(kr => kr.id)
  );

  if (areaKRIds.size === 0) return null;

  // 汇总：initiativeId → { inProgress: [], queued: [], krId }
  const initiativeMap = {};
  for (const task of activeTasks) {
    if (!task.goal_id || !areaKRIds.has(task.goal_id)) continue;
    if (!task.project_id) continue;

    const initId = task.project_id;
    if (!initiativeMap[initId]) {
      initiativeMap[initId] = { inProgress: [], queued: [], krId: task.goal_id };
    }

    if (task.status === 'in_progress') {
      initiativeMap[initId].inProgress.push(task);
    } else if (task.status === 'queued') {
      initiativeMap[initId].queued.push(task);
    }
  }

  if (Object.keys(initiativeMap).length === 0) return null;

  // 优先 1：有 in_progress 任务的 Initiative（Initiative Lock）
  for (const [initId, data] of Object.entries(initiativeMap)) {
    if (data.inProgress.length > 0) {
      const initiative = projects.find(p => p.id === initId);
      const kr = keyResults.find(k => k.id === data.krId);
      if (initiative && kr) {
        return { initiative, kr };
      }
    }
  }

  // 优先 2：无 in_progress，选最早创建的有 queued 任务的 Initiative（FIFO）
  const queuedCandidates = Object.entries(initiativeMap)
    .filter(([, data]) => data.queued.length > 0)
    .map(([initId, data]) => ({
      initiative: projects.find(p => p.id === initId),
      kr: keyResults.find(k => k.id === data.krId),
      queuedCount: data.queued.length
    }))
    .filter(item => item.initiative && item.kr);

  if (queuedCandidates.length === 0) return null;

  // 按 Initiative 创建时间升序（FIFO）
  queuedCandidates.sort(
    (a, b) => new Date(a.initiative.created_at) - new Date(b.initiative.created_at)
  );

  return queuedCandidates[0];
}


/**
 * =============================================================================
 * PR Plans Dispatch (Layer 2 - 工程规划层调度)
 * =============================================================================
 * 三层拆解调度：Initiative → PR Plans → Tasks
 * PR Plans 优先于传统 KR → Task 流程
 */

/**
 * Get all PR Plans for an Initiative, sorted by sequence
 * @param {string} initiativeId - Initiative ID (UUID)
 * @returns {Array} - Array of PR Plan objects
 */
async function getPrPlansByInitiative(initiativeId) {
  // Note: After migration 027, Initiative = Project (same entity)
  // This function queries by project_id, but keeps "Initiative" naming for backward compatibility
  const result = await pool.query(`
    SELECT * FROM pr_plans
    WHERE project_id = $1
    ORDER BY sequence ASC
  `, [initiativeId]);
  return result.rows;
}

/**
 * Check if a PR Plan is completed (all its tasks are completed)
 * @param {string} prPlanId - PR Plan ID (UUID)
 * @returns {boolean} - true if completed, false otherwise
 */
async function isPrPlanCompleted(prPlanId) {
  const result = await pool.query(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
    FROM tasks
    WHERE pr_plan_id = $1
  `, [prPlanId]);

  const { total, completed } = result.rows[0];
  // PR Plan is completed if it has tasks and all are completed
  return parseInt(total) > 0 && parseInt(total) === parseInt(completed);
}

/**
 * Update PR Plan status
 * @param {string} prPlanId - PR Plan ID (UUID)
 * @param {string} status - New status (planning/in_progress/completed/cancelled)
 */
async function updatePrPlanStatus(prPlanId, status) {
  await pool.query(`
    UPDATE pr_plans
    SET status = $1, updated_at = NOW()
    WHERE id = $2
  `, [status, prPlanId]);
}

/**
 * Check if a PR Plan's dependencies are all completed
 * @param {Object} prPlan - PR Plan object with depends_on field
 * @param {Array} allPrPlans - All PR Plans for this Initiative
 * @returns {boolean} - true if all dependencies are met
 */
function canExecutePrPlan(prPlan, allPrPlans) {
  // If no dependencies, can execute
  if (!prPlan.depends_on || prPlan.depends_on.length === 0) {
    return true;
  }

  // Check all dependencies are completed
  for (const depId of prPlan.depends_on) {
    const depPrPlan = allPrPlans.find(p => p.id === depId);
    if (!depPrPlan || depPrPlan.status !== 'completed') {
      return false; // Dependency not met
    }
  }

  return true; // All dependencies met
}

/**
 * Get the next executable PR Plan for an Initiative
 * Priority order: pending status → dependencies met → lowest sequence
 * @param {string} initiativeId - Initiative ID (UUID)
 * @returns {Object|null} - Next PR Plan to execute, or null
 */
async function getNextPrPlan(initiativeId) {
  const allPrPlans = await getPrPlansByInitiative(initiativeId);

  if (allPrPlans.length === 0) {
    return null; // No PR Plans for this Initiative
  }

  // Filter pending PR Plans
  const pendingPlans = allPrPlans.filter(p => p.status === 'planning');

  if (pendingPlans.length === 0) {
    return null; // No pending PR Plans
  }

  // Find first pending plan that meets all dependencies (by sequence order)
  for (const prPlan of pendingPlans) {
    if (canExecutePrPlan(prPlan, allPrPlans)) {
      return prPlan;
    }
  }

  return null; // All pending plans are blocked by dependencies
}

/**
 * Check for PR Plans completion in all active Initiatives
 * Called by tick loop to auto-update PR Plan status
 * @returns {Array} - Array of completed PR Plan IDs
 */
async function checkPrPlansCompletion() {
  const completed = [];

  // Get all in_progress PR Plans
  const result = await pool.query(`
    SELECT * FROM pr_plans WHERE status = 'in_progress'
  `);

  for (const prPlan of result.rows) {
    if (await isPrPlanCompleted(prPlan.id)) {
      await updatePrPlanStatus(prPlan.id, 'completed');
      completed.push(prPlan.id);
      console.log(`✅ PR Plan completed: ${prPlan.title} (${prPlan.id})`);
    }
  }

  return completed;
}

/**
 * Main entry point - called each tick.
 * Iterates through all scored KRs until one produces a task.
 * V3: PR Plans dispatch integration - checks Initiatives first
 */
async function planNextTask(scopeKRIds = null, options = {}) {
  const state = await getGlobalState();

  // V3: Check for PR Plans first (三层拆解优先)
  // Can be skipped via options.skipPrPlans (used by KR rotation tests)
  if (!options.skipPrPlans) {
  // Query all Initiatives (Sub-Projects with PR Plans)
  // After migration 027: Initiative = Sub-Project (in projects table)
  const initiativesResult = await pool.query(`
    SELECT DISTINCT p.* FROM projects p
    INNER JOIN pr_plans pp ON p.id = pp.project_id
    WHERE pp.status IN ('planning', 'in_progress')
    ORDER BY p.created_at ASC
  `);

  for (const initiative of initiativesResult.rows) {
    const nextPrPlan = await getNextPrPlan(initiative.id);
    if (nextPrPlan) {
      // Found executable PR Plan - check if task already exists
      const existingTaskResult = await pool.query(`
        SELECT * FROM tasks WHERE pr_plan_id = $1 AND status IN ('queued', 'in_progress')
        LIMIT 1
      `, [nextPrPlan.id]);

      if (existingTaskResult.rows[0]) {
        // Task already exists for this PR Plan
        const task = existingTaskResult.rows[0];
        return {
          planned: true,
          source: 'pr_plan',
          pr_plan: { id: nextPrPlan.id, title: nextPrPlan.title, sequence: nextPrPlan.sequence },
          task: { id: task.id, title: task.title, priority: task.priority, project_id: task.project_id },
          initiative: { id: initiative.id, title: initiative.name }
        };
      }

      // No task exists yet - indicate PR Plan is ready for task creation (秋米's job)
      return {
        planned: false,
        reason: 'pr_plan_needs_task',
        pr_plan: { id: nextPrPlan.id, title: nextPrPlan.title, dod: nextPrPlan.dod },
        initiative: { id: initiative.id, title: initiative.name }
      };
    }
  }
  } // end skipPrPlans check

  // Area Stream dispatch（流调度层，在 PR Plans 之后、传统 KR dispatch 之前）
  // 每个活跃 Area 保底 1 个 slot，Initiative Lock。
  // 可通过 options.skipAreaStreams=true 跳过（用于测试兼容）
  if (!options.skipAreaStreams) {
    const topAreas = selectTopAreas(state, ACTIVE_AREA_COUNT);
    for (const area of topAreas) {
      const result = selectActiveInitiativeForArea(area, state);
      if (!result) continue;

      const { initiative, kr } = result;
      const task = await generateNextTask(kr, initiative, state);
      if (task) {
        console.log(`[planner] Area stream: ${area.title} → KR: ${kr.title} → Initiative: ${initiative.name}`);
        return {
          planned: true,
          source: 'area_stream',
          area: { id: area.id, title: area.title },
          task: { id: task.id, title: task.title, priority: task.priority, project_id: task.project_id, goal_id: task.goal_id },
          kr: { id: kr.id, title: kr.title },
          initiative: { id: initiative.id, title: initiative.name }
        };
      }
    }
  }

  // No Area Stream task found - fall back to traditional KR dispatch
  // If scoped to specific KRs (from tick focus), filter keyResults before selecting
  if (scopeKRIds && scopeKRIds.length > 0) {
    const scopeSet = new Set(scopeKRIds);
    state.keyResults = state.keyResults.filter(kr => scopeSet.has(kr.id));
  }

  if (state.keyResults.length === 0) {
    return { planned: false, reason: 'no_active_kr' };
  }

  // 方向3：反刍闭环 — 查询最近洞察，流回 KR 选择权重
  const krIds = state.keyResults.map(kr => kr.id);
  const insightAdjustments = await buildInsightAdjustments(krIds);

  // Score and sort all KRs, then try each in order（含反刍洞察调整）
  const scored = scoreKRs(state, insightAdjustments);

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
    result.level = 'global_okr';
    if (!dryRun) {
      const oResult = await pool.query(`
        INSERT INTO goals (title, description, priority, type, status, progress)
        VALUES ($1, $2, $3, 'global_okr', 'pending', 0) RETURNING *
      `, [input.objective.title, input.objective.description || '', input.objective.priority || 'P1']);
      result.created.goals.push(oResult.rows[0]);

      if (Array.isArray(input.objective.key_results)) {
        for (const krInput of input.objective.key_results) {
          const krResult = await pool.query(`
            INSERT INTO goals (title, description, priority, type, parent_id, weight, status, progress, metadata)
            VALUES ($1, $2, $3, 'kr', $4, $5, 'pending', 0, $6) RETURNING *
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
        VALUES ($1, $2, $3, 'kr', $4, $5, 'pending', 0, $6) RETURNING *
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
        INSERT INTO tasks (title, description, priority, project_id, goal_id, status, payload, trigger_source)
        VALUES ($1, $2, $3, $4, $5, 'queued', $6, 'brain_auto') RETURNING *
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
  generateNextTask,
  // Learning penalty
  buildLearningPenaltyMap,
  LEARNING_PENALTY_SCORE,
  LEARNING_LOOKBACK_DAYS,
  LEARNING_FAILURE_THRESHOLD,
  // Content-aware score
  CONTENT_SCORE_KNOWN_DECOMPOSITION_BONUS,
  // PR Plans dispatch functions
  getPrPlansByInitiative,
  isPrPlanCompleted,
  updatePrPlanStatus,
  canExecutePrPlan,
  getNextPrPlan,
  checkPrPlansCompletion,
  // Area Stream dispatch（selectTopAreas / selectActiveInitiativeForArea 已在函数定义处 export）
  ACTIVE_AREA_COUNT
};
