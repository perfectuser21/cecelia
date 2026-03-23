/**
 * OKR 飞轮闭环检查器（新 okr_* 表版本）
 *
 * 对应旧版 initiative-closer.js，但作用于新 OKR 表：
 *   okr_initiatives / okr_scopes / okr_projects
 *
 * 逻辑：
 *   checkOkrInitiativeCompletion: okr_initiatives 下所有 tasks 完成 → 标记完成 → 触发 okr_scope_plan
 *   checkOkrScopeCompletion:      okr_scopes 下所有 initiatives 完成 → 标记完成 → 触发 okr_project_plan
 *   checkOkrProjectCompletion:    okr_projects 下所有 scopes 完成 → 标记完成
 *
 * 触发位置：tick.js（每次 tick 都跑，纯 SQL，无 LLM）
 */

/**
 * 检查并关闭已完成的 OKR Initiatives。
 * initiative 下所有 tasks（通过 okr_initiative_id 关联）完成 → 标记 initiative=completed → 创建 okr_scope_plan 任务
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ closedCount: number, closed: Array<{id: string, title: string}> }>}
 */
export async function checkOkrInitiativeCompletion(pool) {
  // 查所有活跃中的 okr_initiatives（pending/in_progress 均检查）
  const initiativesResult = await pool.query(`
    SELECT id, title, scope_id
    FROM okr_initiatives
    WHERE status IN ('in_progress', 'active', 'pending')
  `);

  const initiatives = initiativesResult.rows;
  if (initiatives.length === 0) {
    return { closedCount: 0, closed: [] };
  }

  const closed = [];

  for (const initiative of initiatives) {
    // 查该 initiative 下的 tasks 状态分布（via okr_initiative_id）
    const statsResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status NOT IN ('dep_failed', 'cancelled'))  AS total,
        COUNT(*) FILTER (WHERE status = 'queued')                           AS queued,
        COUNT(*) FILTER (WHERE status = 'in_progress')                     AS in_progress,
        COUNT(*) FILTER (WHERE status = 'quarantined')                     AS quarantine
      FROM tasks
      WHERE okr_initiative_id = $1
    `, [initiative.id]);

    const stats = statsResult.rows[0];
    const total = parseInt(stats.total, 10);
    const queued = parseInt(stats.queued, 10);
    const inProgress = parseInt(stats.in_progress, 10);
    const quarantine = parseInt(stats.quarantine, 10);

    // 关闭条件：有任务 + 无飞行中任务 + 无隔离任务
    if (total === 0 || queued > 0 || inProgress > 0 || quarantine > 0) {
      continue;
    }

    // 标记为完成
    await pool.query(`
      UPDATE okr_initiatives
      SET status = 'completed',
          updated_at = NOW()
      WHERE id = $1
    `, [initiative.id]);

    // 记录事件
    try {
      await pool.query(`
        INSERT INTO cecelia_events (event_type, source, payload)
        VALUES ('okr_initiative_completed', 'okr_closer', $1)
      `, [JSON.stringify({
        initiative_id: initiative.id,
        initiative_title: initiative.title,
        scope_id: initiative.scope_id,
        total_tasks: total,
        closed_at: new Date().toISOString(),
      })]);
    } catch {
      // cecelia_events 写入失败不阻塞主流程
    }

    // 触发 okr_scope_plan 飞轮：Initiative 完成后，检查是否需要规划下一个 Initiative
    if (initiative.scope_id) {
      // 检查该 scope 下是否还有未完成的 initiative
      const remainingResult = await pool.query(
        `SELECT COUNT(*) AS cnt FROM okr_initiatives WHERE scope_id = $1 AND status != 'completed'`,
        [initiative.scope_id]
      );
      const remaining = parseInt(remainingResult.rows[0].cnt, 10);

      if (remaining > 0) {
        // 还有未完成 initiative，触发 okr_scope_plan 规划下一个
        const existingPlan = await pool.query(
          `SELECT id FROM tasks WHERE task_type = 'okr_scope_plan' AND description::text LIKE $1 AND status IN ('queued', 'in_progress') LIMIT 1`,
          [`%${initiative.scope_id}%`]
        );
        if (existingPlan.rows.length === 0) {
          const scopeResult = await pool.query(
            'SELECT title FROM okr_scopes WHERE id = $1',
            [initiative.scope_id]
          );
          const scopeTitle = scopeResult.rows[0]?.title ?? initiative.scope_id;

          await pool.query(`
            INSERT INTO tasks (title, task_type, description, priority, status, trigger_source)
            VALUES ($1, 'okr_scope_plan', $2, 'P1', 'queued', 'brain_auto')
          `, [
            `规划 ${scopeTitle} 下一个 Initiative`,
            JSON.stringify({
              okr_scope_id: initiative.scope_id,
              reason: 'okr_initiative_completed',
              completed_initiative_id: initiative.id,
            }),
          ]);
        }
      }
      // remaining === 0 时由 checkOkrScopeCompletion 处理
    }

    closed.push({ id: initiative.id, title: initiative.title });
  }

  return { closedCount: closed.length, closed };
}

/**
 * 检查并关闭已完成的 OKR Scopes。
 * scope 下所有 initiatives 完成 → 标记 scope=completed → 创建 okr_project_plan 任务
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ closedCount: number, closed: Array<{id: string, title: string}> }>}
 */
export async function checkOkrScopeCompletion(pool) {
  // 查所有活跃中的 scopes
  const scopesResult = await pool.query(`
    SELECT id, title, project_id
    FROM okr_scopes
    WHERE status IN ('in_progress', 'active', 'planning')
  `);

  const scopes = scopesResult.rows;
  if (scopes.length === 0) {
    return { closedCount: 0, closed: [] };
  }

  const closed = [];

  for (const scope of scopes) {
    // 查该 scope 下所有 initiatives 的状态
    const statsResult = await pool.query(`
      SELECT
        COUNT(*)                                                  AS total,
        COUNT(*) FILTER (WHERE status = 'completed')             AS completed,
        COUNT(*) FILTER (WHERE status NOT IN ('completed', 'cancelled')) AS active
      FROM okr_initiatives
      WHERE scope_id = $1
    `, [scope.id]);

    const stats = statsResult.rows[0];
    const total = parseInt(stats.total, 10);
    const active = parseInt(stats.active, 10);

    // 关闭条件：有 initiative + 所有 initiative 都已完成（无活跃）
    if (total === 0 || active > 0) {
      continue;
    }

    // 标记为完成
    await pool.query(`
      UPDATE okr_scopes
      SET status = 'completed',
          updated_at = NOW()
      WHERE id = $1
    `, [scope.id]);

    // 记录事件
    try {
      await pool.query(`
        INSERT INTO cecelia_events (event_type, source, payload)
        VALUES ('okr_scope_completed', 'okr_closer', $1)
      `, [JSON.stringify({
        scope_id: scope.id,
        scope_title: scope.title,
        project_id: scope.project_id,
        closed_at: new Date().toISOString(),
      })]);
    } catch {
      // 非阻塞
    }

    // 触发 okr_project_plan：规划 project 的下一个 scope
    if (scope.project_id) {
      const existingPlan = await pool.query(
        `SELECT id FROM tasks WHERE task_type = 'okr_project_plan' AND description::text LIKE $1 AND status IN ('queued', 'in_progress') LIMIT 1`,
        [`%${scope.project_id}%`]
      );
      if (existingPlan.rows.length === 0) {
        const projectResult = await pool.query(
          'SELECT title FROM okr_projects WHERE id = $1',
          [scope.project_id]
        );
        const projectTitle = projectResult.rows[0]?.title ?? scope.project_id;

        await pool.query(`
          INSERT INTO tasks (title, task_type, description, priority, status, trigger_source)
          VALUES ($1, 'okr_project_plan', $2, 'P1', 'queued', 'brain_auto')
        `, [
          `规划 ${projectTitle} 下一个 Scope`,
          JSON.stringify({
            okr_project_id: scope.project_id,
            reason: 'okr_scope_completed',
            completed_scope_id: scope.id,
          }),
        ]);
      }
    }

    closed.push({ id: scope.id, title: scope.title });
  }

  return { closedCount: closed.length, closed };
}

/**
 * 检查并关闭已完成的 OKR Projects。
 * project 下所有 scopes 完成 → 标记 project=completed
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ closedCount: number, closed: Array<{id: string, title: string}> }>}
 */
export async function checkOkrProjectCompletion(pool) {
  // 查所有活跃中的 projects
  const projectsResult = await pool.query(`
    SELECT id, title, kr_id
    FROM okr_projects
    WHERE status IN ('in_progress', 'active', 'planning')
  `);

  const projects = projectsResult.rows;
  if (projects.length === 0) {
    return { closedCount: 0, closed: [] };
  }

  const closed = [];

  for (const project of projects) {
    // 查该 project 下所有 scopes 状态
    const statsResult = await pool.query(`
      SELECT
        COUNT(*)                                                  AS total,
        COUNT(*) FILTER (WHERE status = 'completed')             AS completed,
        COUNT(*) FILTER (WHERE status NOT IN ('completed', 'cancelled')) AS active
      FROM okr_scopes
      WHERE project_id = $1
    `, [project.id]);

    const stats = statsResult.rows[0];
    const total = parseInt(stats.total, 10);
    const active = parseInt(stats.active, 10);

    // 关闭条件：有 scope + 所有 scope 都已完成
    if (total === 0 || active > 0) {
      continue;
    }

    // 标记为完成
    await pool.query(`
      UPDATE okr_projects
      SET status = 'completed',
          updated_at = NOW()
      WHERE id = $1
    `, [project.id]);

    // 记录事件
    try {
      await pool.query(`
        INSERT INTO cecelia_events (event_type, source, payload)
        VALUES ('okr_project_completed', 'okr_closer', $1)
      `, [JSON.stringify({
        project_id: project.id,
        project_title: project.title,
        kr_id: project.kr_id,
        closed_at: new Date().toISOString(),
      })]);
    } catch {
      // 非阻塞
    }

    closed.push({ id: project.id, title: project.title });
  }

  return { closedCount: closed.length, closed };
}
