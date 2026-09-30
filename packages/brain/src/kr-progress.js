/**
 * KR Progress Calculator - KR 进度自动更新
 *
 * 棒4（决策 ee4842a6/3feeae3e，接力棒链 2afa6d69）留痕：原公式基于
 * okr_projects → okr_scopes → okr_initiatives 的 initiative 完成率计算 KR 进度。
 * scope/initiative 层退役（migration 499 写保护）后，这条链路不再产生任何新数据，
 * 继续查询没有意义——已清空为 no-op（恒返回 total=0/progress=0，不查询
 * okr_scopes/okr_initiatives，kr-progress-sync-plugin.js 每小时 tick 一次的调用
 * 因此不再触发这两张表的查询）。
 *
 * "按 project 聚合 KR 进度"的新公式是接力棒棒5的工作范围，本棒不做。
 *
 * 触发位置：
 *   - tick.js（经 kr-progress-sync-plugin.js）：每小时定时同步（fallback，kr-verifier 优先）
 */

/**
 * 更新单个 KR 的进度。已退役：不再查询 okr_projects/okr_scopes/okr_initiatives，
 * 恒返回零变化（不写 key_results.progress）。
 *
 * @param {import('pg').Pool} _pool - 未使用，保留签名兼容旧调用方
 * @param {string} krId - KR 的 goal ID
 * @returns {Promise<{ krId: string|null, progress: number, completed: number, total: number }>}
 */
export async function updateKrProgress(_pool, krId) {
  if (!krId) return { krId: null, progress: 0, completed: 0, total: 0 };
  return { krId, progress: 0, completed: 0, total: 0 };
}

/**
 * 同步所有活跃 KR 的进度。已退役：不再查询 key_results/okr_*，恒返回零变化。
 *
 * @param {import('pg').Pool} _pool - 未使用，保留签名兼容旧调用方
 * @returns {Promise<{ updated: number, results: Array }>}
 */
export async function syncAllKrProgress(_pool) {
  return { updated: 0, results: [] };
}
