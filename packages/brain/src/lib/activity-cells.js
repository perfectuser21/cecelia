/**
 * 每个 Activity 固定 8 个验收格（树+仓库 v3.0）：迁移 521 给存量补过；
 * 新建 Activity 的两个入口（合同同步插入、沉淀技能候选）都在建行当下调 ensureEightCells 补齐。
 */

/** 8 个固定验收格（与迁移 521 的标准键一致）。 */
export const CELL_KEYS = Object.freeze(['promise', 'nfr', 'judgment', 'invariants', 'failure', 'readback', 'adversarial', 'shelf_life']);

/** 缺的补灰格，已有的不动（唯一键 step_id+cell_kind+cell_key，重跑幂等；格子表的 step_id 就是 Activity id）。 */
export async function ensureEightCells(db, activityId, journeyId) {
  for (const key of CELL_KEYS) {
    await db.query(
      `INSERT INTO activity_cells (journey_id, step_id, cell_kind, cell_key)
       VALUES ($1, $2, 'element', $3) ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL DO NOTHING`,
      [journeyId, activityId, key]);
  }
}
