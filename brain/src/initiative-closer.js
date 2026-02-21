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

/**
 * 检查并关闭已完成的 Initiatives。
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @returns {Promise<{ closedCount: number, closed: Array<{id: string, name: string}> }>}
 */
async function checkInitiativeCompletion(pool) {
  // 查所有 in_progress 的 initiatives
  const initiativesResult = await pool.query(`
    SELECT id, name
    FROM projects
    WHERE type = 'initiative'
      AND status = 'in_progress'
  `);

  const initiatives = initiativesResult.rows;
  if (initiatives.length === 0) {
    return { closedCount: 0, closed: [] };
  }

  const closed = [];

  for (const initiative of initiatives) {
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

  return { closedCount: closed.length, closed };
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

  return { closedCount: closed.length, closed };
}

export { checkInitiativeCompletion, checkProjectCompletion };
