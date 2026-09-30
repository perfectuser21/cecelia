/**
 * Project / KR 进度聚合 — 接力棒链 2afa6d69 棒5（决策 ee4842a6/3feeae3e）
 *
 * GTD 四级 O→KR→Project→Task 落地后（棒1 PR #5731 建 projects 真身表，
 * 棒4 PR #5750 冻结 scope/initiative 层），KR 进度改为直接从它名下的
 * projects/tasks 聚合算出，不再依赖已退役的 okr_scopes/okr_initiatives 链路。
 *
 * 口径：
 *   - project 进度 = 该 project 下未取消任务（task_type<>'project' 排除子项目根任务，
 *     status<>'cancelled' 排除已取消）里 completed/completed_no_pr 的占比；
 *     project 名下没有任务时按 project.status 映射（completed→100，其它→0）。
 *   - KR 进度 = 名下 projects（WHERE kr_id=$1 AND status NOT IN ('cancelled','archived')）
 *     的 project 进度算术平均（等权）；KR 名下无 project 时由调用方决定是否覆盖
 *     （本模块只负责聚合，不碰 key_results 写入——写口在 kr-progress.js）。
 */

const COMPLETED_TASK_STATUSES = ['completed', 'completed_no_pr'];

/**
 * 由任务完成计数算单个 project 的进度（无任务时按 project.status 映射）。
 * @param {string} status - project.status
 * @param {number} total - 未取消/非子项目根任务数
 * @param {number} done - 其中 completed/completed_no_pr 数
 * @returns {number} 0~100，保留两位小数
 */
function projectProgressFromCounts(status, total, done) {
  if (total > 0) {
    return Math.round((done / total) * 10000) / 100;
  }
  return status === 'completed' ? 100 : 0;
}

/**
 * 批量查询多个 KR 名下的 projects（各自附带任务完成率），一次往返算完，避免 N+1。
 *
 * @param {import('pg').Pool} pool
 * @param {string[]} krIds
 * @returns {Promise<Record<string, Array<{id:string,name:string,status:string,progress:number,task_total:number,task_done:number}>>>}
 */
export async function getProjectsForKrBatch(pool, krIds) {
  if (!krIds || krIds.length === 0) return {};

  const { rows: projects } = await pool.query(
    `SELECT id, name, status, kr_id
       FROM projects
      WHERE kr_id = ANY($1) AND status NOT IN ('cancelled', 'archived')
      ORDER BY created_at`,
    [krIds]
  );
  if (projects.length === 0) return {};

  const projectIds = projects.map((p) => p.id);
  const { rows: taskStats } = await pool.query(
    `SELECT project_id,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = ANY($2))::int AS done
       FROM tasks
      WHERE project_id = ANY($1) AND task_type <> 'project' AND status <> 'cancelled'
      GROUP BY project_id`,
    [projectIds, COMPLETED_TASK_STATUSES]
  );

  const statsByProject = {};
  for (const row of taskStats) {
    statsByProject[row.project_id] = row;
  }

  const byKr = {};
  for (const p of projects) {
    const stats = statsByProject[p.id] || { total: 0, done: 0 };
    const entry = {
      id: p.id,
      name: p.name,
      status: p.status,
      progress: projectProgressFromCounts(p.status, stats.total, stats.done),
      task_total: stats.total,
      task_done: stats.done,
    };
    if (!byKr[p.kr_id]) byKr[p.kr_id] = [];
    byKr[p.kr_id].push(entry);
  }
  return byKr;
}

/**
 * 单个 KR 名下的 projects（附任务完成率）。getProjectsForKrBatch 的单 KR 便捷封装。
 * @param {import('pg').Pool} pool
 * @param {string} krId
 */
export async function getProjectsForKr(pool, krId) {
  if (!krId) return [];
  const byKr = await getProjectsForKrBatch(pool, [krId]);
  return byKr[krId] || [];
}

/**
 * KR 进度 = 名下 projects 进度算术平均（等权）。
 *
 * @param {import('pg').Pool} pool
 * @param {string} krId
 * @returns {Promise<{ hasProjects: boolean, progress: number|null, projectCount: number, projects: Array }>}
 *   hasProjects=false 时 progress=null——调用方（kr-progress.js）据此决定不覆盖 key_results.progress 现值。
 */
export async function computeKrProgressFromProjects(pool, krId) {
  const projects = await getProjectsForKr(pool, krId);
  if (projects.length === 0) {
    return { hasProjects: false, progress: null, projectCount: 0, projects: [] };
  }
  const avg = projects.reduce((sum, p) => sum + p.progress, 0) / projects.length;
  return {
    hasProjects: true,
    progress: Math.round(avg),
    projectCount: projects.length,
    projects,
  };
}

export { COMPLETED_TASK_STATUSES };
