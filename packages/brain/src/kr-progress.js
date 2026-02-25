/**
 * KR Progress Calculator - KR 进度自动更新
 *
 * 根据 Initiative 完成情况自动计算 KR 的 progress 百分比。
 *
 * 公式：
 *   progress = (completed_initiatives / countable_initiatives) * 100
 *   countable = active + in_progress + completed（不含 pending/archived）
 *
 * 触发位置：
 *   - initiative-closer.js：initiative 关闭后
 *   - tick.js Section 0.12：每小时定时同步
 */

/**
 * 更新单个 KR 的进度。
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @param {string} krId - KR 的 goal ID
 * @returns {Promise<{ krId: string, progress: number, completed: number, total: number }>}
 */
export async function updateKrProgress(pool, krId) {
  if (!krId) return { krId: null, progress: 0, completed: 0, total: 0 };

  // 查 KR 关联的所有 projects
  const projectsResult = await pool.query(`
    SELECT p.id
    FROM projects p
    JOIN project_kr_links pkl ON pkl.project_id = p.id
    WHERE pkl.kr_id = $1
      AND p.type = 'project'
  `, [krId]);

  if (projectsResult.rows.length === 0) {
    return { krId, progress: 0, completed: 0, total: 0 };
  }

  const projectIds = projectsResult.rows.map(r => r.id);

  // 查这些 projects 下所有可计数的 initiatives
  const statsResult = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed
    FROM projects
    WHERE parent_id = ANY($1)
      AND type = 'initiative'
      AND status IN ('active', 'in_progress', 'completed')
  `, [projectIds]);

  const total = parseInt(statsResult.rows[0].total, 10);
  const completed = parseInt(statsResult.rows[0].completed, 10);

  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  // 更新 goals.progress
  await pool.query(`
    UPDATE goals
    SET progress = $2,
        updated_at = NOW()
    WHERE id = $1
  `, [krId, progress]);

  return { krId, progress, completed, total };
}

/**
 * 同步所有活跃 KR 的进度。
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @returns {Promise<{ updated: number, results: Array }>}
 */
export async function syncAllKrProgress(pool) {
  // 查所有 in_progress 的 KR
  const krsResult = await pool.query(`
    SELECT id, title
    FROM goals
    WHERE type IN ('kr', 'area_kr', 'global_kr', 'key_result')
      AND status NOT IN ('completed', 'cancelled')
  `);

  const results = [];
  for (const kr of krsResult.rows) {
    const result = await updateKrProgress(pool, kr.id);
    if (result.total > 0) {
      results.push(result);
    }
  }

  return { updated: results.length, results };
}
