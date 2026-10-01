/** KR 重算：项目等权聚合为唯一口径，修复任务 7aeb81a6。 */
import { computeKrProgressFromProjects } from '../project-progress.js';

function finiteNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function recalculateKrProgress(pool, krId) {
  const { rows } = await pool.query(
    'SELECT id, target_value, current_value, progress FROM key_results WHERE id = $1', [krId],
  );
  if (!rows.length) return null;
  const kr = rows[0];
  const { hasProjects, progress: computed, projects } = await computeKrProgressFromProjects(pool, krId);
  const progress = hasProjects ? computed : kr.progress;
  const target = finiteNumber(kr.target_value);
  const current = target === null ? null : hasProjects
    ? finiteNumber(Math.round((progress / 100) * target * 100) / 100)
    : finiteNumber(kr.current_value);

  if (hasProjects) {
    await pool.query(`
      UPDATE key_results SET progress = $2, current_value = $3,
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'progress_source', 'projects_v1', 'progress_computed_at', now()::text
        ), updated_at = NOW()
      WHERE id = $1
    `, [krId, progress, current]);
  } else if (current === null && kr.current_value !== null) {
    // 无项目只修复无目标/非有限数污染，保留进度与原有来源。
    await pool.query('UPDATE key_results SET current_value = NULL, updated_at = NOW() WHERE id = $1', [krId]);
  }
  return {
    kr_id: krId, progress, target_value: target, current_value: current,
    completed_tasks: projects.reduce((sum, p) => sum + p.task_done, 0),
    total_tasks: projects.reduce((sum, p) => sum + p.task_total, 0),
  };
}
