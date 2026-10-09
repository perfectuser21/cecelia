/**
 * OKR 完成检测飞轮（已退役，决策 ee4842a6/3feeae3e，接力棒链 2afa6d69 棒4）
 *
 * 对标旧系统：initiative-closer.js（同样已退役）。
 * okr_initiatives / okr_scopes / okr_projects 停写停读（migration 499 加了写保护
 * trigger），本文件三个检测函数原逻辑整段查这三张表，业务意义已不存在，清空为 no-op。
 *
 * 保留原函数签名/导出名不变：tick-runner.js 仍在每轮调用，现在什么都不做，直接
 * 返回"零变化"结果，因此 tick 一轮不再产生任何对 okr_initiatives/okr_scopes/
 * okr_projects 的查询。
 */

let loggedOnce = false;
function logRetiredOnce() {
  if (loggedOnce) return;
  loggedOnce = true;
  console.info('[okr-closer] OKR scope/initiative/project 完成检测已退役（决策 ee4842a6），已 no-op');
}

/**
 * 已退役：不再查询 okr_initiatives/tasks，恒返回零变化。
 * @param {import('pg').Pool} _pool - 未使用，保留签名兼容旧调用方
 * @returns {Promise<{ closedCount: number, closed: Array }>}
 */
async function checkOkrInitiativeCompletion(_pool) {
  logRetiredOnce();
  return { closedCount: 0, closed: [] };
}

/**
 * 已退役：不再查询 okr_scopes/okr_initiatives，恒返回零变化。
 * @param {import('pg').Pool} _pool - 未使用，保留签名兼容旧调用方
 * @returns {Promise<{ closedCount: number, closed: Array }>}
 */
async function checkOkrScopeCompletion(_pool) {
  logRetiredOnce();
  return { closedCount: 0, closed: [] };
}

/**
 * 已退役：不再查询 okr_projects/okr_scopes，恒返回零变化。
 * @param {import('pg').Pool} _pool - 未使用，保留签名兼容旧调用方
 * @returns {Promise<{ closedCount: number, closed: Array }>}
 */
async function checkOkrProjectCompletion(_pool) {
  logRetiredOnce();
  return { closedCount: 0, closed: [] };
}

export { checkOkrInitiativeCompletion, checkOkrScopeCompletion, checkOkrProjectCompletion };
