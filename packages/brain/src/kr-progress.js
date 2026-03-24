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

  // 迁移：projects WHERE type='project' → okr_projects（IDs 相同，project_kr_links 不变）
  const projectsResult = await pool.query(`
    SELECT p.id
    FROM okr_projects p
    JOIN project_kr_links pkl ON pkl.project_id = p.id
    WHERE pkl.kr_id = $1
  `, [krId]);

  if (projectsResult.rows.length === 0) {
    return { krId, progress: 0, completed: 0, total: 0 };
  }

  const projectIds = projectsResult.rows.map(r => r.id);

  // 迁移：projects WHERE type='initiative' AND parent_id → okr_initiatives（通过 scope_id 关联）
  const statsResult = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE oi.status = 'completed') AS completed
    FROM okr_initiatives oi
    JOIN okr_scopes os ON os.id = oi.scope_id
    WHERE os.project_id = ANY($1)
      AND oi.status IN ('active', 'in_progress', 'completed')
  `, [projectIds]);

  const total = parseInt(statsResult.rows[0].total, 10);
  const completed = parseInt(statsResult.rows[0].completed, 10);

  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  // UPDATE 保留旧表（触发器同步到 key_results）
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
  // 迁移：goals WHERE type IN ('area_okr','area_kr','global_kr','key_result') → objectives + key_results
  const krsResult = await pool.query(`
    SELECT id, title FROM objectives WHERE status NOT IN ('completed', 'cancelled')
    UNION ALL
    SELECT id, title FROM key_results WHERE status NOT IN ('completed', 'cancelled')
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
