import { isCompanyKr, COMPANY_KR_SQL_GUARD } from './lib/company-kr-metrics.js';
/**
 * KR Progress Calculator - KR 进度自动更新
 *
 * 棒5（决策 ee4842a6/3feeae3e，接力棒链 2afa6d69）：GTD 四级 O→KR→Project→Task 落地后
 * （棒1 PR #5731 建 projects 真身表，棒4 PR #5750 冻结 scope/initiative 层），KR 进度
 * 改为直接从它名下的 projects/tasks 聚合算出——scope/initiative 链路已不再产生新数据。
 *
 * 公式（口径详见 project-progress.js）：
 *   KR 进度 = 名下 projects（WHERE kr_id=$1 AND status NOT IN ('cancelled','archived')）
 *             的 project 完成率算术平均（等权）。
 *   KR 名下没有 project 时不覆盖 key_results.progress 现值（避免把手填/历史进度打成 0）。
 *
 * 触发位置：
 *   - pr-callback-handler.js：PR 合并后
 *   - kr-progress-sync-plugin.js（经 tick-runner.js）：每小时定时同步（fallback，kr-verifier 优先）
 */

import { computeKrProgressFromProjects } from './project-progress.js';

/**
 * 更新单个 KR 的进度。名下无 project 时不写库，直接回读现值。
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @param {string} krId - KR 的 goal ID
 * @returns {Promise<{ krId: string|null, progress: number, completed: number, total: number }>}
 */
export async function updateKrProgress(pool, krId) {
  if (!krId) return { krId: null, progress: 0, completed: 0, total: 0 };

  const identity = await pool.query('SELECT metadata, custom_props FROM key_results WHERE id=$1', [krId]);
  if (isCompanyKr(identity.rows[0])) return { krId, skipped: true, reason: 'company_metric', progress: identity.rows[0].metadata?.company_metric?.ratio == null ? null : identity.rows[0].metadata.company_metric.ratio * 100, completed: 0, total: 0 };

  const { hasProjects, progress, projectCount, projects } = await computeKrProgressFromProjects(pool, krId);

  if (!hasProjects) {
    const cur = await pool.query('SELECT progress FROM key_results WHERE id = $1', [krId]);
    return { krId, progress: cur.rows[0]?.progress ?? 0, completed: 0, total: 0 };
  }

  await pool.query(`
    UPDATE key_results
    SET progress = $2,
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'progress_source', 'projects_v1',
          'progress_computed_at', now()::text
        ),
        updated_at = NOW()
    WHERE id = $1 AND ${COMPANY_KR_SQL_GUARD}
  `, [krId, progress]);

  const completed = projects.filter((p) => p.progress === 100).length;
  return { krId, progress, completed, total: projectCount };
}

/**
 * 同步所有活跃 KR 的进度。
 * 跳过：已有启用 kr_verifier 的 KR（避免 fallback 覆盖 verifier 的计算结果）、
 * 已 completed/cancelled 的 KR。
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @returns {Promise<{ updated: number, results: Array }>}
 */
export async function syncAllKrProgress(pool) {
  const krsResult = await pool.query(`
    SELECT id FROM key_results
    WHERE status NOT IN ('completed', 'cancelled') AND ${COMPANY_KR_SQL_GUARD}
      AND id NOT IN (
        SELECT kr_id FROM kr_verifiers WHERE enabled = true
      )
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
