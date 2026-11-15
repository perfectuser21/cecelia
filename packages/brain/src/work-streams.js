/** Read-only state and selection for the Work Streams dashboard. */
import pool from './db.js';

export const ACTIVE_AREA_COUNT = parseInt(process.env.ACTIVE_AREA_COUNT || '3', 10);

export async function getGlobalState() {
  const [objectives, keyResults, projects, activeTasks] = await Promise.all([
    pool.query(`
      SELECT id, title, status, area_id, owner_role, metadata, custom_props, created_at, updated_at,
             type, parent_id, priority
      FROM (
        SELECT id, title, status, area_id, owner_role, metadata, custom_props, created_at, updated_at,
               'vision' AS type, NULL::uuid AS parent_id, NULL AS priority
        FROM visions
        WHERE status NOT IN ('completed', 'cancelled')
        UNION ALL
        SELECT id, title, status, area_id, owner_role, metadata, custom_props, created_at, updated_at,
               'area_okr' AS type, vision_id AS parent_id, priority
        FROM objectives
        WHERE status NOT IN ('completed', 'cancelled')
      ) sub
      ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END
    `),
    pool.query(`
      SELECT id, title, status, area_id, owner_role, metadata, custom_props, created_at, updated_at,
             type, parent_id, priority, progress, weight
      FROM (
        SELECT id, title, status, area_id, owner_role, metadata, custom_props, created_at, updated_at,
               'area_okr' AS type, vision_id AS parent_id, priority, NULL AS progress, NULL AS weight
        FROM objectives
        WHERE status NOT IN ('completed', 'cancelled')
        UNION ALL
        SELECT id, title, status, area_id, owner_role, metadata, custom_props, created_at, updated_at,
               'area_okr' AS type, objective_id AS parent_id, priority, progress, weight
        FROM key_results
        WHERE status NOT IN ('completed', 'cancelled')
      ) sub
      ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END
    `),
    pool.query(`
      SELECT id, name, status, 'project' AS type, NULL::uuid AS parent_id,
             COALESCE(repo_path, metadata->>'repo_path') AS repo_path, created_at, updated_at,
             metadata->>'domain' AS domain, NULL AS execution_mode
      FROM projects
      WHERE status IN ('active', 'in_progress', 'planning')
      UNION ALL
      SELECT id, title AS name, status, 'scope' AS type, project_id AS parent_id,
             NULL AS repo_path, created_at, updated_at, NULL AS domain, NULL AS execution_mode
      FROM okr_scopes
      WHERE status IN ('active', 'in_progress', 'planning')
      UNION ALL
      SELECT id, title AS name, status, 'initiative' AS type, scope_id AS parent_id,
             NULL AS repo_path, created_at, updated_at, NULL AS domain, NULL AS execution_mode
      FROM okr_initiatives
      WHERE status IN ('running', 'planned')
    `),
    pool.query(`SELECT * FROM tasks WHERE status IN ('queued', 'in_progress') ORDER BY created_at ASC`),
  ]);

  return {
    objectives: objectives.rows,
    keyResults: keyResults.rows,
    projects: projects.rows,
    activeTasks: activeTasks.rows
  };
}

export function selectTopAreas(state, count) {
  const { objectives, keyResults, activeTasks } = state;

  const areas = objectives.filter(
    g => g.type === 'vision' && g.status !== 'completed' && g.status !== 'cancelled'
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
