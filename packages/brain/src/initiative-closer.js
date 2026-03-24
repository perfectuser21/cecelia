/**
 * Initiative 闭环检查器
 *
 * 每次 tick 触发，纯 SQL 逻辑，无 LLM。
 *
 * 逻辑：
 *   1. 查所有 status='in_progress' 的 okr_initiatives/okr_scopes/okr_projects
 *   2. 对每个 initiative，查 tasks 状态分布
 *   3. 如果 total > 0 AND queued = 0 AND in_progress = 0 → 标记完成
 *   4. 更新对应新表 status='completed', completed_at=NOW()
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
  // 查所有 in_progress 或 active 的 initiatives（迁移：projects WHERE type='initiative' → okr_initiatives）
  const initiativesResult = await pool.query(`
    SELECT id, title AS name
    FROM okr_initiatives
    WHERE status IN ('in_progress', 'active')
  `);

  const initiatives = initiativesResult.rows;
  if (initiatives.length === 0) {
    return { closedCount: 0, closed: [], activatedCount: 0 };
  }

  const closed = [];

  for (const initiative of initiatives) {
    // 查该 initiative 下的 tasks 状态分布（排除 dep_failed：它们被阻塞，不算活跃）
    const statsResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status != 'dep_failed')    AS total,
        COUNT(*) FILTER (WHERE status = 'queued')          AS queued,
        COUNT(*) FILTER (WHERE status = 'in_progress')     AS in_progress,
        COUNT(*) FILTER (WHERE status = 'dep_failed')      AS dep_failed,
        COUNT(*) FILTER (WHERE status = 'quarantined')     AS quarantine
      FROM tasks
      WHERE project_id = $1
    `, [initiative.id]);

    const stats = statsResult.rows[0];
    const total = parseInt(stats.total, 10);
    const queued = parseInt(stats.queued, 10);
    const inProgress = parseInt(stats.in_progress, 10);
    const quarantine = parseInt(stats.quarantine, 10);

    // 关闭条件：有任务 + 没有飞行中的任务 + 没有隔离中的任务
    // quarantine > 0 表示有任务被隔离，需要人工介入，不自动关闭
    if (total === 0 || queued > 0 || inProgress > 0 || quarantine > 0) {
      continue;
    }

    // 标记为完成
    await pool.query(`
      UPDATE okr_initiatives
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

    // 触发 scope_plan 飞轮：Initiative 完成后，查找 parent scope（迁移：projects → okr_scopes via scope_id）
    const parentResult = await pool.query(
      `SELECT id, 'scope' AS type, title AS name FROM okr_scopes WHERE id = (SELECT scope_id FROM okr_initiatives WHERE id = $1) LIMIT 1`,
      [initiative.id]
    );
    const parent = parentResult.rows[0];
    if (parent && parent.type === 'scope') {
      // 检查该 Scope 下是否还有未完成的 Initiative（迁移：projects WHERE parent_id → okr_initiatives WHERE scope_id）
      const remainingResult = await pool.query(
        `SELECT COUNT(*) as cnt FROM okr_initiatives WHERE scope_id = $1 AND status != 'completed'`,
        [parent.id]
      );
      const remaining = parseInt(remainingResult.rows[0].cnt, 10);
      if (remaining === 0) {
        // 所有 Initiative 完成，checkScopeCompletion 会处理
      } else {
        // 还有未完成的 Initiative，或需要创建新的 → 触发 scope_plan
        const existingPlan = await pool.query(
          `SELECT id FROM tasks WHERE task_type = 'scope_plan' AND project_id = $1 AND status IN ('queued', 'in_progress') LIMIT 1`,
          [parent.id]
        );
        if (existingPlan.rows.length === 0) {
          await pool.query(`
            INSERT INTO tasks (title, task_type, project_id, description, priority, status, trigger_source)
            VALUES ($1, 'scope_plan', $2, $3, 'P1', 'queued', 'brain_auto')
            ON CONFLICT DO NOTHING
          `, [
            `规划 ${parent.name} 下一个 Initiative`,
            parent.id,
            JSON.stringify({ scope_id: parent.id, reason: 'initiative_completed', completed_initiative_id: initiative.id })
          ]);
          console.log(`[initiative-closer] Created scope_plan task for scope ${parent.id} (initiative ${initiative.name} completed)`);
        }
      }
    }

    closed.push({ id: initiative.id, name: initiative.name });
  }

  // KR 进度更新：initiative 关闭后自动重算关联 KR 的 progress
  if (closed.length > 0) {
    try {
      // 获取关闭的 initiatives 关联的 KR IDs（通过 okr_scopes → okr_projects.kr_id）
      const closedIds = closed.map(c => c.id);
      const krResult = await pool.query(`
        SELECT DISTINCT op.kr_id
        FROM okr_initiatives oi
        JOIN okr_scopes os ON oi.scope_id = os.id
        JOIN okr_projects op ON op.id = os.project_id
        WHERE oi.id = ANY($1)
          AND op.kr_id IS NOT NULL
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

  // 注意：activateNextInitiatives 由 tick.js Section 0.10 统一调用，此处不重复调用（避免 race condition）
  return { closedCount: closed.length, closed, activatedCount: 0 };
}

/**
 * Project 闭环检查器
 *
 * 每次 tick 触发，纯 SQL 逻辑，无 LLM。
 *
 * 逻辑：
 *   1. 查所有 status='active' 的 okr_projects
 *   2. 对每个 project，检查其下是否有 initiative，且全部 completed
 *   3. 如果 total_initiatives > 0 AND 没有 non-completed 的 initiative
 *      → 更新 okr_projects 状态 status='completed', completed_at=NOW()
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
  //   - 存在至少一个子项（scope 或 initiative，避免误关空 project）
  //   - 没有 non-completed 的子项（scope 或 initiative）
  // 支持两种结构：Project→Scope→Initiative（新）和 Project→Initiative（旧）
  // 迁移：projects WHERE type='project' → okr_projects；子项通过 okr_scopes 关联
  const projectsResult = await pool.query(`
    SELECT op.id, op.title AS name, op.kr_id
    FROM okr_projects op
    WHERE op.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM okr_scopes os
        WHERE os.project_id = op.id AND os.status != 'completed'
      )
      AND NOT EXISTS (
        SELECT 1 FROM okr_initiatives oi
        JOIN okr_scopes os ON oi.scope_id = os.id
        WHERE os.project_id = op.id AND oi.status != 'completed'
      )
      AND (
        EXISTS (SELECT 1 FROM okr_scopes os WHERE os.project_id = op.id)
        OR EXISTS (SELECT 1 FROM okr_initiatives oi JOIN okr_scopes os ON oi.scope_id = os.id WHERE os.project_id = op.id)
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
      UPDATE okr_projects
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
 *   - tick.js Section 0.10（每次 tick，统一管理激活逻辑）
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

  // 1. 查当前 active initiative 数量（迁移：projects WHERE type='initiative' → okr_initiatives）
  const activeCountResult = await pool.query(`
    SELECT COUNT(*) AS cnt
    FROM okr_initiatives
    WHERE status IN ('active', 'in_progress')
  `);
  const currentActive = parseInt(activeCountResult.rows[0].cnt, 10);

  // 2. 计算空位
  const availableSlots = maxActive - currentActive;
  if (availableSlots <= 0) {
    return 0;
  }

  // 3. 从 pending 中按创建时间激活（okr_initiatives → okr_scopes → okr_projects.kr_id）
  const activateResult = await pool.query(`
    UPDATE okr_initiatives
    SET status = 'active',
        updated_at = NOW()
    WHERE id IN (
      SELECT oi.id
      FROM okr_initiatives oi
      LEFT JOIN okr_scopes os ON oi.scope_id = os.id
      LEFT JOIN okr_projects op ON op.id = os.project_id
      WHERE oi.status = 'pending'
      ORDER BY oi.created_at ASC
      LIMIT $1
    )
    RETURNING id, title AS name
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

/**
 * Scope 闭环检查器
 *
 * 逻辑：
 *   1. 查所有 status='active' 的 okr_scopes
 *   2. 对每个 scope，检查其下所有 initiative 是否全部 completed
 *   3. 如果 total > 0 AND 没有 non-completed 的 initiative
 *      → 更新 okr_scopes 状态 status='completed', completed_at=NOW()
 *      → INSERT INTO cecelia_events (event_type='scope_completed', ...)
 *   4. 返回关闭的 scope 数量
 */
async function checkScopeCompletion(pool) {
  // 迁移：projects WHERE type='scope' → okr_scopes；子 initiatives via okr_initiatives.scope_id
  const scopesResult = await pool.query(`
    SELECT os.id, os.title AS name, os.project_id AS parent_id
    FROM okr_scopes os
    WHERE os.status IN ('active', 'in_progress')
      AND NOT EXISTS (
        SELECT 1 FROM okr_initiatives oi
        WHERE oi.scope_id = os.id AND oi.status != 'completed'
      )
      AND EXISTS (
        SELECT 1 FROM okr_initiatives oi WHERE oi.scope_id = os.id
      )
  `);

  const scopes = scopesResult.rows;
  if (scopes.length === 0) {
    return { closedCount: 0, closed: [] };
  }

  const closed = [];

  for (const scope of scopes) {
    await pool.query(
      `UPDATE okr_scopes SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [scope.id]
    );

    await pool.query(`
      INSERT INTO cecelia_events (event_type, source, payload)
      VALUES ('scope_completed', 'initiative_closer', $1)
    `, [JSON.stringify({
      scope_id: scope.id,
      scope_name: scope.name,
      parent_project_id: scope.parent_id,
      timestamp: new Date().toISOString(),
    })]);

    // 触发 project_plan 飞轮：Scope 完成后创建 project_plan 任务规划下一个 Scope
    if (scope.parent_id) {
      await pool.query(`
        INSERT INTO tasks (title, task_type, project_id, description, priority, status, trigger_source)
        VALUES ($1, 'project_plan', $2, $3, 'P1', 'queued', 'brain_auto')
        ON CONFLICT DO NOTHING
      `, [
        `规划下一个 Scope (${scope.name} 已完成)`,
        scope.parent_id,
        JSON.stringify({ project_id: scope.parent_id, reason: 'scope_completed', completed_scope_id: scope.id, completed_scope_name: scope.name })
      ]);
      console.log(`[initiative-closer] Created project_plan task for project ${scope.parent_id} (scope ${scope.name} completed)`);
    }

    console.log(`[initiative-closer] Scope completed: ${scope.name} (${scope.id})`);
    closed.push({ id: scope.id, name: scope.name, parent_id: scope.parent_id });
  }

  return { closedCount: closed.length, closed };
}

export { checkInitiativeCompletion, checkScopeCompletion, checkProjectCompletion, activateNextInitiatives };
