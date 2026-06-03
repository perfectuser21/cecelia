/**
 * selectLoadBalancedMachine — 多候选机器里选一台（半显式 executor / 标签多机器场景）。
 *
 * 默认策略：保守取第一台（确定性）。codex 多机器负载均衡（selectBestBridge 健康探活）
 * 是 executor.js 的现有职责，路由器通过 deps.selectLoadBalanced 注入可覆盖，避免在
 * 纯路由逻辑里耦合 bridge 健康探活的副作用。
 *
 * Spec: docs/superpowers/specs/2026-06-03-machine-executor-routing-design.md §单元2 半显式
 *
 * @param {Array} candidates  满足条件的 active 机器列表
 * @returns {Promise<Object|null>} 选中的机器
 */
export async function selectLoadBalancedMachine(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  return candidates[0];
}
