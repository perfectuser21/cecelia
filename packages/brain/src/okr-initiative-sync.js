/**
 * okr-initiative-sync — 已退役（决策 ee4842a6/3feeae3e，接力棒链 2afa6d69 棒4）
 *
 * 原用途：harness 执行期把 okr_initiatives 维护成"活态镜像"（PR 2b-2b）。
 * okr_initiatives 层随 GTD O→KR→Project→Task 四级模型退役而冻结（migration 499
 * 写保护），这套"镜像同步"业务意义已不存在——停读停写，直接清空为 no-op。
 *
 * 保留导出函数签名不变（executor.js / orchestrator/run.js 调用方无需改动，
 * 本就 try/catch 包裹、best-effort 语义），现在什么都不做，恒返回 null。
 */

/** okr_initiatives 生命周期合法值（与 migration 299 CHECK 一致，仅用于参数校验）。 */
const LIFECYCLE = new Set(['planned', 'queued', 'running', 'done', 'failed', 'archived', 'cancelled']);

/**
 * 已退役：不再查询/新建 okr_initiatives，恒返回 null。
 * @param {import('pg').Pool} _db - 未使用，保留签名兼容旧调用方
 * @param {string} _harnessTaskId - 未使用
 * @returns {Promise<null>}
 */
export async function resolveOrCreateOkrInitiative(_db, _harnessTaskId) {
  return null;
}

/**
 * 已退役：不再查询/更新 okr_initiatives，恒返回 null。仍保留 lifecycle 合法性
 * 校验（纯参数校验，非 DB 查询），防止调用方传入非法值时无声吞掉。
 * @param {import('pg').Pool} _db - 未使用，保留签名兼容旧调用方
 * @param {string} _harnessTaskId - 未使用
 * @param {string} lifecycleStatus - planned/queued/running/done/failed/archived/cancelled
 * @returns {Promise<null>}
 */
export async function syncOkrInitiativeStatus(_db, _harnessTaskId, lifecycleStatus) {
  if (!LIFECYCLE.has(lifecycleStatus)) {
    throw new Error(`syncOkrInitiativeStatus: 非法生命周期值 '${lifecycleStatus}'`);
  }
  return null;
}
