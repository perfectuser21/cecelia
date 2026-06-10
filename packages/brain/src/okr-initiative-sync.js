/**
 * okr-initiative-sync — harness 执行期把 okr_initiatives 维护成"活态镜像"（PR 2b-2b）
 *
 * 双轴模型合一第一步（dual-run，不碰执行/线程/看门狗机器）：
 * harness 仍以 harness_initiative task 为执行轴，但每次生命周期推进同步对应
 * okr_initiatives 行的 status（running→done/failed），让规划侧 Initiative 成为实时真相。
 *
 * 解析顺序：harness_initiative_migration_map（2b-2a 建）→ tasks.okr_initiative_id → 新建。
 * 调用方负责 try/catch（镜像是 best-effort，绝不可搞崩 harness 主流程）。
 */

import pool from './db.js';

/** okr_initiatives 生命周期合法值（与 migration 299 CHECK 一致）。 */
const LIFECYCLE = new Set(['planned', 'queued', 'running', 'done', 'failed', 'archived', 'cancelled']);
const TERMINAL = new Set(['done', 'failed', 'archived', 'cancelled']);

/**
 * 解析 harness task 对应的 okr_initiative id；缺失则新建（status=running）并建立映射。
 *
 * @param {import('pg').Pool} db
 * @param {string} harnessTaskId - harness_initiative task 的 id（= initiative_runs.initiative_id）
 * @returns {Promise<string|null>} okr_initiative id；task 不存在时 null
 */
export async function resolveOrCreateOkrInitiative(db, harnessTaskId) {
  if (!harnessTaskId) return null;

  // 1. 映射表命中（2b-2a 迁移 + 本函数历史新建都会写这里）
  const mapped = await db.query(
    `SELECT okr_initiative_id FROM harness_initiative_migration_map WHERE harness_task_id = $1`,
    [harnessTaskId]
  );
  if (mapped.rows[0]) return mapped.rows[0].okr_initiative_id;

  // 2. task.okr_initiative_id 已指定（POST /tasks 时显式传入）→ 用它并回填映射表
  const t = await db.query(
    `SELECT id, title, okr_initiative_id, project_id, description FROM tasks WHERE id = $1`,
    [harnessTaskId]
  );
  const task = t.rows[0];
  if (!task) return null;

  if (task.okr_initiative_id) {
    await db.query(
      `INSERT INTO harness_initiative_migration_map (harness_task_id, okr_initiative_id)
       VALUES ($1, $2) ON CONFLICT (harness_task_id) DO NOTHING`,
      [harnessTaskId, task.okr_initiative_id]
    );
    return task.okr_initiative_id;
  }

  // 3. 新建 okr_initiatives 行（running）。project_id 仅携带有效引用（避 FK 违例）。
  const ins = await db.query(
    `INSERT INTO okr_initiatives (title, status, project_id, description, custom_props)
     VALUES (
       $1, 'running',
       (CASE WHEN $2::uuid IN (SELECT id FROM okr_projects) THEN $2::uuid ELSE NULL END),
       $3,
       jsonb_build_object('source', 'harness_live', 'harness_task_id', $4::text)
     )
     RETURNING id`,
    [task.title || '(untitled harness initiative)', task.project_id, task.description, harnessTaskId]
  );
  const newId = ins.rows[0].id;

  await db.query(
    `INSERT INTO harness_initiative_migration_map (harness_task_id, okr_initiative_id)
     VALUES ($1, $2) ON CONFLICT (harness_task_id) DO NOTHING`,
    [harnessTaskId, newId]
  );
  await db.query(
    `UPDATE tasks SET okr_initiative_id = $2 WHERE id = $1 AND okr_initiative_id IS NULL`,
    [harnessTaskId, newId]
  );
  return newId;
}

/**
 * 同步 okr_initiative 状态到给定生命周期值。终态额外置 completed_at。
 *
 * @param {import('pg').Pool} db
 * @param {string} harnessTaskId
 * @param {string} lifecycleStatus - planned/queued/running/done/failed/archived/cancelled
 * @returns {Promise<string|null>} okr_initiative id
 */
export async function syncOkrInitiativeStatus(db = pool, harnessTaskId, lifecycleStatus) {
  if (!LIFECYCLE.has(lifecycleStatus)) {
    throw new Error(`syncOkrInitiativeStatus: 非法生命周期值 '${lifecycleStatus}'`);
  }
  const okrId = await resolveOrCreateOkrInitiative(db, harnessTaskId);
  if (!okrId) return null;

  const setCompleted = TERMINAL.has(lifecycleStatus) ? ', completed_at = COALESCE(completed_at, NOW())' : '';
  await db.query(
    `UPDATE okr_initiatives SET status = $2, updated_at = NOW()${setCompleted} WHERE id = $1`,
    [okrId, lifecycleStatus]
  );
  return okrId;
}
