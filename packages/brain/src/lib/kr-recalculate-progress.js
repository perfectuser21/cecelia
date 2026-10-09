import { isCompanyKr, COMPANY_KR_SQL_GUARD } from './company-kr-metrics.js';
/** KR 重算：项目等权聚合为唯一口径，修复任务 7aeb81a6。 */
import { computeKrProgressFromProjects } from '../project-progress.js';

function finiteNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function recalculateKrProgress(pool, krId, retries = 2) {
  const { rows } = await pool.query(
    'SELECT id, target_value, current_value, progress, metadata, custom_props FROM key_results WHERE id = $1', [krId],
  );
  if (!rows.length) return null;
  const kr = rows[0];
  if (isCompanyKr(kr)) return { kr_id: krId, skipped: true, reason: 'company_metric', progress: kr.metadata?.company_metric?.ratio == null ? null : kr.metadata.company_metric.ratio * 100, current_value: kr.metadata?.company_metric?.current, target_value: kr.metadata?.company_metric?.target };
  const { hasProjects, progress: computed, projects } = await computeKrProgressFromProjects(pool, krId);
  const progress = hasProjects ? computed : kr.progress;
  const target = finiteNumber(kr.target_value);
  const current = target === null ? null : hasProjects
    ? finiteNumber(Math.round((progress / 100) * target * 100) / 100)
    : finiteNumber(kr.current_value);

  let write;
  if (hasProjects) {
    write = await pool.query(`
      UPDATE key_results SET progress = $2, current_value = $3,
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'progress_source', 'projects_v1', 'progress_computed_at', now()::text
        ), updated_at = NOW()
      WHERE id = $1 AND ${COMPANY_KR_SQL_GUARD} AND target_value IS NOT DISTINCT FROM $4
        AND current_value IS NOT DISTINCT FROM $5 AND progress IS NOT DISTINCT FROM $6
    `, [krId, progress, current, kr.target_value, kr.current_value, kr.progress]);
  } else if (current === null && kr.current_value !== null) {
    // 无项目只修复无目标/非有限数污染，保留进度与原有来源。
    write = await pool.query(`
      UPDATE key_results SET current_value = NULL, updated_at = NOW()
      WHERE id = $1 AND ${COMPANY_KR_SQL_GUARD} AND target_value IS NOT DISTINCT FROM $2
        AND current_value IS NOT DISTINCT FROM $3 AND progress IS NOT DISTINCT FROM $4
    `, [krId, kr.target_value, kr.current_value, kr.progress]);
  }
  if (write && write.rowCount === 0) {
    // 人类并发更新优先；按最新值再算，持续冲突时停止而不覆盖。
    if (retries > 0) return recalculateKrProgress(pool, krId, retries - 1);
    const error = new Error('KR changed during recalculation');
    error.status = 409;
    throw error;
  }
  return {
    kr_id: krId, progress, target_value: target, current_value: current,
    completed_tasks: projects.reduce((sum, p) => sum + p.task_done, 0),
    total_tasks: projects.reduce((sum, p) => sum + p.task_total, 0),
  };
}
