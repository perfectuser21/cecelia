/**
 * Initiative 闭环检查器（已退役，决策 ee4842a6/3feeae3e，接力棒链 2afa6d69 棒4）
 *
 * scope/initiative 两层拆解机器随 GTD O→KR→Project→Task 四级模型退役而冻结：
 * okr_initiatives / okr_scopes / okr_projects 停写停读（migration 499 加了写保护
 * trigger，本文件是"停读"那一半——原逻辑整段查 okr_initiatives/okr_scopes/okr_projects，
 * 业务意义已不存在，不再改读 projects，直接清空为 no-op）。
 *
 * 保留原函数签名/导出名不变，只是函数体不再碰数据库：
 *   - tick-runner.js 仍在每轮调用这几个函数（改调用点是不必要的连带改动），
 *     它们现在什么都不做，直接返回"零变化"结果，tick 一轮因此不再产生任何
 *     对 okr_initiatives/okr_scopes/okr_projects 的查询。
 *   - getMaxActiveInitiatives / MAX_ACTIVE_INITIATIVES 与 scope/initiative 拆解
 *     无关（纯 worker slot 容量公式），不受影响，原样保留。
 *
 * 触发位置：tick.js Section 0.8-0.10（原逻辑，函数本身已 no-op）。
 */

import { computeCapacity } from './capacity.js';

let loggedOnce = false;
function logRetiredOnce() {
  if (loggedOnce) return;
  loggedOnce = true;
  console.info('[initiative-closer] scope/initiative 层已退役（决策 ee4842a6），闭环检查已 no-op');
}

/**
 * 已退役：不再查询 okr_initiatives，恒返回零变化。
 * @param {import('pg').Pool} _pool - 未使用，保留签名兼容旧调用方
 * @returns {Promise<{ closedCount: number, closed: Array, activatedCount: number }>}
 */
async function checkInitiativeCompletion(_pool) {
  logRetiredOnce();
  return { closedCount: 0, closed: [], activatedCount: 0 };
}

/**
 * 已退役：不再查询 okr_projects/okr_scopes/okr_initiatives，恒返回零变化。
 * @param {import('pg').Pool} _pool - 未使用，保留签名兼容旧调用方
 * @returns {Promise<{ closedCount: number, closed: Array }>}
 */
async function checkProjectCompletion(_pool) {
  logRetiredOnce();
  return { closedCount: 0, closed: [] };
}

/**
 * 已退役：不再查询 okr_scopes/okr_initiatives，恒返回零变化。
 * @param {import('pg').Pool} _pool - 未使用，保留签名兼容旧调用方
 * @returns {Promise<{ closedCount: number, closed: Array }>}
 */
async function checkScopeCompletion(_pool) {
  logRetiredOnce();
  return { closedCount: 0, closed: [] };
}

/**
 * 获取 initiative 层最大 active 数量（从 capacity 公式计算）。与 scope/initiative
 * 拆解退役无关，纯 worker slot 容量公式，原样保留。
 *
 * @param {number} slots - Pool C 可用 slot 数量
 * @returns {number} 最大 active initiative 数量
 */
export function getMaxActiveInitiatives(slots) {
  return computeCapacity(slots).initiative.max;
}

/** 默认值（SLOTS=9 时 max=9）。tick.js 运行时通过参数传入实际 slots。 */
export const MAX_ACTIVE_INITIATIVES = 9;

/**
 * 已退役：不再查询/更新 okr_initiatives，恒返回 0（激活数量）。
 * @param {import('pg').Pool} _pool - 未使用，保留签名兼容旧调用方
 * @param {number} [_slotsOverride] - 未使用
 * @returns {Promise<number>} 恒为 0
 */
async function activateNextInitiatives(_pool, _slotsOverride) {
  logRetiredOnce();
  return 0;
}

export { checkInitiativeCompletion, checkScopeCompletion, checkProjectCompletion, activateNextInitiatives };
