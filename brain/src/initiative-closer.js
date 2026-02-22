/**
 * Initiative 闭环检查器
 *
 * 每次 tick 触发，纯 SQL 逻辑，无 LLM。
 *
 * 逻辑：
 *   1. 查所有 type='initiative' AND status='in_progress' 的 projects
 *   2. 对每个 initiative，查 tasks 状态分布
 *   3. 如果 total > 0 AND queued = 0 AND in_progress = 0 → 标记完成
 *   4. UPDATE projects SET status='completed', completed_at=NOW()
 *   5. INSERT INTO cecelia_events (event_type='initiative_completed', ...)
 *   6. 返回关闭数量
 *
 * 触发位置：tick.js Section 0.8（每次 tick 都跑，SQL 轻量）
 */

import { computeCapacity } from './capacity.js';
import { updateKrProgress } from './kr-progress.js';
import { reviewProjectCompletion, shouldAdjustPlan, createPlanAdjustmentTask } from './progress-reviewer.js';

/**
 * 检查并关闭已完成的 Initiatives。
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @returns {Promise<{ closedCount: number, closed: Array<{id: string, name: string}>, activatedCount: number }>}
 */
async function checkInitiativeCompletion(pool) {
  // 查所有 in_progress 的 initiatives（排除 orchestrated，由 orchestrator 管理）
  const initiativesResult = await pool.query(`
    SELECT id, name, execution_mode
    FROM projects
    WHERE type = 'initiative'
      AND status = 'in_progress'
  `);

  const initiatives = initiativesResult.rows;
  if (initiatives.length === 0) {
    return { closedCount: 0, closed: [], activatedCount: 0 };
  }

  const closed = [];

  for (const initiative of initiatives) {
    // orchestrated initiative 由 orchestrator 管理，跳过
    if (initiative.execution_mode === 'orchestrated') continue;

    // 查该 initiative 下的 tasks 状态分布
    const statsResult = await pool.query(`
      SELECT
        COUNT(*)                                        AS total,
        COUNT(*) FILTER (WHERE status = 'queued')      AS queued,
        COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress
      FROM tasks
      WHERE project_id = $1
    `, [initiative.id]);

    const stats = statsResult.rows[0];
    const total = parseInt(stats.total, 10);
    const queued = parseInt(stats.queued, 10);
    const inProgress = parseInt(stats.in_progress, 10);

    // 关闭条件：有任务 + 没有飞行中的任务
    if (total === 0 || queued > 0 || inProgress > 0) {
      continue;
    }

    // 标记为完成
    await pool.query(`
      UPDATE projects
      SET status = 'completed',
          completed_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
    `, [initiative.id]);

    // 记录事件
    await pool.query(`
      INSERT INTO cecelia_events (event_type, source, payload)
      VALUES ('initiative_completed', 'initiative_closer', $1)
    `, [JSON.stringify({
      initiative_id: initiative.id,
      initiative_name: initiative.name,
      total_tasks: total,
      closed_at: new Date().toISOString(),
    })]);

    closed.push({ id: initiative.id, name: initiative.name });
  }

  // D7: initiative 完成后立刻激活下一批 pending，补充空位
  let activatedCount = 0;
  if (closed.length > 0) {
    activatedCount = await activateNextInitiatives(pool);

    // KR 进度更新：initiative 关闭后自动重算关联 KR 的 progress
    try {
      // 获取关闭的 initiatives 关联的 KR IDs（通过 parent project 的 project_kr_links）
      const closedIds = closed.map(c => c.id);
      const krResult = await pool.query(`
        SELECT DISTINCT pkl.kr_id
        FROM projects p
        JOIN project_kr_links pkl ON pkl.project_id = p.parent_id
        WHERE p.id = ANY($1)
          AND pkl.kr_id IS NOT NULL
      `, [closedIds]);

      for (const row of krResult.rows) {
        const result = await updateKrProgress(pool, row.kr_id);
        if (result.total > 0) {
          console.log(`[initiative-closer] KR ${row.kr_id} progress → ${result.progress}% (${result.completed}/${result.total})`);
        }
      }
    } catch (krErr) {
      console.error('[initiative-closer] KR progress update failed (non-fatal):', krErr.message);
    }
  }

  return { closedCount: closed.length, closed, activatedCount };
}

/**
 * Project 闭环检查器
 *
 * 每次 tick 触发，纯 SQL 逻辑，无 LLM。
 *
 * 逻辑：
 *   1. 查所有 type='project' AND status='active' 的 projects
 *   2. 对每个 project，检查其下是否有 initiative，且全部 completed
 *   3. 如果 total_initiatives > 0 AND 没有 non-completed 的 initiative
 *      → UPDATE projects SET status='completed', completed_at=NOW()
 *      → INSERT INTO cecelia_events (event_type='project_completed', ...)
 *   4. 返回关闭的 project 数量
 *
 * 触发位置：tick.js Section 0.9（每次 tick 都跑，SQL 轻量）
 */

/**
 * 检查并关闭已完成的 Projects。
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @returns {Promise<{ closedCount: number, closed: Array<{id: string, name: string, kr_id: string}> }>}
 */
async function checkProjectCompletion(pool) {
  // 查所有满足条件的 active Project：
  //   - 存在至少一个 initiative（避免误关空 project）
  //   - 没有 non-completed 的 initiative
  const projectsResult = await pool.query(`
    SELECT p.id, p.name, p.kr_id
    FROM projects p
    WHERE p.type = 'project'
      AND p.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM projects child
        WHERE child.parent_id = p.id
          AND child.type = 'initiative'
          AND child.status != 'completed'
      )
      AND EXISTS (
        SELECT 1 FROM projects child
        WHERE child.parent_id = p.id
          AND child.type = 'initiative'
      )
  `);

  const projects = projectsResult.rows;
  if (projects.length === 0) {
    return { closedCount: 0, closed: [] };
  }

  const closed = [];

  for (const project of projects) {
    // 标记为完成
    await pool.query(`
      UPDATE projects
      SET status = 'completed',
          completed_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
    `, [project.id]);

    // 记录事件
    await pool.query(`
      INSERT INTO cecelia_events (event_type, source, payload)
      VALUES ('project_completed', 'project_closer', $1)
    `, [JSON.stringify({
      project_id: project.id,
      project_name: project.name,
      kr_id: project.kr_id,
      closed_at: new Date().toISOString(),
    })]);

    closed.push({ id: project.id, name: project.name, kr_id: project.kr_id });
  }

  // 渐进验证：Project 完成后触发审查 + 计划调整
  for (const project of closed) {
    try {
      const adjustment = await shouldAdjustPlan(pool, project.kr_id, project.id);
      if (adjustment) {
        await createPlanAdjustmentTask(pool, {
          krId: project.kr_id,
          completedProjectId: project.id,
          suggestion: adjustment,
        });
        console.log(`[project-closer] Triggered plan adjustment review for "${project.name}"`);
      }
    } catch (reviewErr) {
      console.error(`[project-closer] Plan adjustment review failed for "${project.name}": ${reviewErr.message}`);
    }
  }

  return { closedCount: closed.length, closed };
}

/**
 * Initiative 队列管理器
 *
 * 从 pending initiative 中按优先级激活，确保 active 总数不超过 MAX。
 *
 * 激活逻辑：
 *   1. 查当前 active initiative 数量
 *   2. 如果 < MAX_ACTIVE_INITIATIVES，计算空位数
 *   3. 从 pending 中按 KR 优先级（P0 > P1 > P2）和创建时间激活
 *   4. 返回激活数量
 *
 * 触发位置：
 *   - tick.js Section 0.10（每次 tick）
 *   - checkInitiativeCompletion() 关闭 initiative 后（保证有空位就填上）
 */

/**
 * 获取 initiative 层最大 active 数量（从 capacity 公式计算）。
 *
 * @param {number} slots - Pool C 可用 slot 数量
 * @returns {number} 最大 active initiative 数量
 */
export function getMaxActiveInitiatives(slots) {
  return computeCapacity(slots).initiative.max;
}

/** 默认值（SLOTS=9 时 max=9）。tick.js 运行时通过参数传入实际 slots。 */
export const MAX_ACTIVE_INITIATIVES = 9;

/**
 * 从 pending initiative 中按优先级激活，使 active 总数不超过容量上限。
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @param {number} [slotsOverride] - 可选，手动指定 SLOTS（用于测试）
 * @returns {Promise<number>} 本次激活的 initiative 数量
 */
async function activateNextInitiatives(pool, slotsOverride) {
  // 从 capacity 公式获取上限
  const maxActive = typeof slotsOverride === 'number'
    ? computeCapacity(slotsOverride).initiative.max
    : MAX_ACTIVE_INITIATIVES; // 运行时 fallback 到常量（避免 async import 复杂度）

  // 1. 查当前 active initiative 数量（包含 active + in_progress）
  const activeCountResult = await pool.query(`
    SELECT COUNT(*) AS cnt
    FROM projects
    WHERE type = 'initiative'
      AND status IN ('active', 'in_progress')
  `);
  const currentActive = parseInt(activeCountResult.rows[0].cnt, 10);

  // 2. 计算空位
  const availableSlots = maxActive - currentActive;
  if (availableSlots <= 0) {
    return 0;
  }

  // 3. 从 pending 中按优先级激活
  const activateResult = await pool.query(`
    UPDATE projects
    SET status = 'active',
        updated_at = NOW()
    WHERE id IN (
      SELECT p.id
      FROM projects p
      LEFT JOIN goals g ON g.id = p.kr_id
      WHERE p.type = 'initiative'
        AND p.status = 'pending'
      ORDER BY
        CASE g.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
        p.created_at ASC
      LIMIT $1
    )
    RETURNING id, name
  `, [availableSlots]);

  const activated = activateResult.rowCount ?? 0;

  if (activated > 0) {
    // 记录激活事件
    await pool.query(`
      INSERT INTO cecelia_events (event_type, source, payload)
      VALUES ('initiatives_activated', 'initiative_queue', $1)
    `, [JSON.stringify({
      activated_count: activated,
      activated_names: activateResult.rows.map(r => r.name),
      previous_active: currentActive,
      new_active: currentActive + activated,
      max_allowed: maxActive,
      timestamp: new Date().toISOString(),
    })]);
  }

  return activated;
}

export { checkInitiativeCompletion, checkProjectCompletion, activateNextInitiatives };
