/**
 * OKR 完成检测飞轮（新 OKR 表：okr_initiatives / okr_scopes / okr_projects）
 *
 * 对标旧系统：initiative-closer.js（操作 projects 表）
 * 层级：key_results → okr_projects → okr_scopes → okr_initiatives → tasks
 *
 * 每次 tick 触发，纯 SQL 逻辑，无 LLM。
 */

/**
 * Initiative 完成检测
 *
 * 逻辑：
 *   1. 查所有 status 不在 completed/cancelled 的 okr_initiatives
 *   2. 对每个 initiative，查关联 tasks（via okr_initiative_id）的状态分布
 *   3. total > 0 且无 queued/in_progress → 标记 completed
 *   4. 若所属 scope 还有其他未完成 initiative → 创建 okr_scope_plan 任务
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ closedCount: number, closed: Array<{id: string, title: string}> }>}
 */
async function checkOkrInitiativeCompletion(pool) {
  const initiativesResult = await pool.query(`
    SELECT id, title, scope_id
    FROM okr_initiatives
    WHERE status NOT IN ('completed', 'cancelled')
  `);

  const initiatives = initiativesResult.rows;
  if (initiatives.length === 0) {
    return { closedCount: 0, closed: [] };
  }

  const closed = [];

  for (const initiative of initiatives) {
    const statsResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status != 'dep_failed')   AS total,
        COUNT(*) FILTER (WHERE status = 'queued')        AS queued,
        COUNT(*) FILTER (WHERE status = 'in_progress')   AS in_progress,
        COUNT(*) FILTER (WHERE status = 'quarantined')   AS quarantine
      FROM tasks
      WHERE okr_initiative_id = $1
    `, [initiative.id]);

    const stats = statsResult.rows[0];
    const total = parseInt(stats.total, 10);
    const queued = parseInt(stats.queued, 10);
    const inProgress = parseInt(stats.in_progress, 10);
    const quarantine = parseInt(stats.quarantine, 10);

    // 关闭条件：有任务 + 无活跃任务 + 无隔离任务
    if (total === 0 || queued > 0 || inProgress > 0 || quarantine > 0) {
      continue;
    }

    await pool.query(`
      UPDATE okr_initiatives
      SET status = 'completed', updated_at = NOW()
      WHERE id = $1
    `, [initiative.id]);

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

    // 飞轮：创建 okr_scope_plan 任务（若 scope 下还有未完成 initiative）
    if (initiative.scope_id) {
      const remainingResult = await pool.query(`
        SELECT COUNT(*) AS cnt
        FROM okr_initiatives
        WHERE scope_id = $1 AND status != 'completed'
      `, [initiative.scope_id]);

      const remaining = parseInt(remainingResult.rows[0].cnt, 10);

      if (remaining > 0) {
        // 还有未完成 initiative，触发 scope_plan 评估下一步
        const existingPlan = await pool.query(`
          SELECT id FROM tasks
          WHERE task_type = 'okr_scope_plan'
            AND description::jsonb ->> 'okr_scope_id' = $1
            AND status IN ('queued', 'in_progress')
          LIMIT 1
        `, [initiative.scope_id]);

        if (existingPlan.rows.length === 0) {
          const scopeResult = await pool.query(
            `SELECT title FROM okr_scopes WHERE id = $1`,
            [initiative.scope_id]
          );
          const scopeTitle = scopeResult.rows[0]?.title || initiative.scope_id;

          await pool.query(`
            INSERT INTO tasks (title, task_type, description, priority, status, trigger_source)
            VALUES ($1, 'okr_scope_plan', $2, 'P1', 'queued', 'brain_auto')
            ON CONFLICT DO NOTHING
          `, [
            `规划 OKR Scope「${scopeTitle}」下一个 Initiative`,
            JSON.stringify({
              okr_scope_id: initiative.scope_id,
              reason: 'okr_initiative_completed',
              completed_initiative_id: initiative.id,
              completed_initiative_title: initiative.title,
            }),
          ]);

        }
      }
    }

    closed.push({ id: initiative.id, title: initiative.title });
  }

  return { closedCount: closed.length, closed };
}

/**
 * Scope 完成检测
 *
 * 逻辑：
 *   1. 查所有 status 不在 completed/cancelled 的 okr_scopes
 *   2. 检查子 initiatives 是否全部 completed
 *   3. 全完成 → 标记 scope completed → 创建 okr_project_plan 任务
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ closedCount: number, closed: Array<{id: string, title: string}> }>}
 */
async function checkOkrScopeCompletion(pool) {
  const scopesResult = await pool.query(`
    SELECT s.id, s.title, s.project_id
    FROM okr_scopes s
    WHERE s.status NOT IN ('completed', 'cancelled')
      AND EXISTS (
        SELECT 1 FROM okr_initiatives WHERE scope_id = s.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM okr_initiatives WHERE scope_id = s.id AND status != 'completed'
      )
  `);

  const scopes = scopesResult.rows;
  if (scopes.length === 0) {
    return { closedCount: 0, closed: [] };
  }

  const closed = [];

  for (const scope of scopes) {
    await pool.query(`
      UPDATE okr_scopes
      SET status = 'completed', updated_at = NOW()
      WHERE id = $1
    `, [scope.id]);

    await pool.query(`
      INSERT INTO cecelia_events (event_type, source, payload)
      VALUES ('okr_scope_completed', 'okr_closer', $1)
    `, [JSON.stringify({
      scope_id: scope.id,
      scope_title: scope.title,
      project_id: scope.project_id,
      closed_at: new Date().toISOString(),
    })]);

    // 飞轮：创建 okr_project_plan 任务
    if (scope.project_id) {
      const existingPlan = await pool.query(`
        SELECT id FROM tasks
        WHERE task_type = 'okr_project_plan'
          AND description::jsonb ->> 'okr_project_id' = $1
          AND status IN ('queued', 'in_progress')
        LIMIT 1
      `, [scope.project_id]);

      if (existingPlan.rows.length === 0) {
        const projectResult = await pool.query(
          `SELECT title FROM okr_projects WHERE id = $1`,
          [scope.project_id]
        );
        const projectTitle = projectResult.rows[0]?.title || scope.project_id;

        await pool.query(`
          INSERT INTO tasks (title, task_type, description, priority, status, trigger_source)
          VALUES ($1, 'okr_project_plan', $2, 'P1', 'queued', 'brain_auto')
          ON CONFLICT DO NOTHING
        `, [
          `规划 OKR Project「${projectTitle}」下一个 Scope`,
          JSON.stringify({
            okr_project_id: scope.project_id,
            reason: 'okr_scope_completed',
            completed_scope_id: scope.id,
            completed_scope_title: scope.title,
          }),
        ]);

      }
    }

    closed.push({ id: scope.id, title: scope.title, project_id: scope.project_id });
  }

  return { closedCount: closed.length, closed };
}

/**
 * Project 完成检测
 *
 * 逻辑：
 *   1. 查所有 status 不在 completed/cancelled 的 okr_projects
 *   2. 检查子 scopes 是否全部 completed
 *   3. 全完成 → 标记 project completed
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ closedCount: number, closed: Array<{id: string, title: string}> }>}
 */
async function checkOkrProjectCompletion(pool) {
  const projectsResult = await pool.query(`
    SELECT p.id, p.title, p.kr_id
    FROM okr_projects p
    WHERE p.status NOT IN ('completed', 'cancelled')
      AND EXISTS (
        SELECT 1 FROM okr_scopes WHERE project_id = p.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM okr_scopes WHERE project_id = p.id AND status != 'completed'
      )
  `);

  const projects = projectsResult.rows;
  if (projects.length === 0) {
    return { closedCount: 0, closed: [] };
  }

  const closed = [];

  for (const project of projects) {
    await pool.query(`
      UPDATE okr_projects
      SET status = 'completed', updated_at = NOW()
      WHERE id = $1
    `, [project.id]);

    await pool.query(`
      INSERT INTO cecelia_events (event_type, source, payload)
      VALUES ('okr_project_completed', 'okr_closer', $1)
    `, [JSON.stringify({
      project_id: project.id,
      project_title: project.title,
      kr_id: project.kr_id,
      closed_at: new Date().toISOString(),
    })]);

    closed.push({ id: project.id, title: project.title, kr_id: project.kr_id });
  }

  return { closedCount: closed.length, closed };
}

export { checkOkrInitiativeCompletion, checkOkrScopeCompletion, checkOkrProjectCompletion };
