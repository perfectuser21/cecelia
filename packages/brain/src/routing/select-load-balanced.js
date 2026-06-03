/**
 * selectLoadBalancedMachine — 多候选机器里选一台（半显式 executor / 标签多机器场景）。
 *
 * YAGNI 占位（本期不做负载均衡/健康探活）：始终 return candidates[0]，只保证确定性
 * （配合 load-machines 的 `ORDER BY name` 得到稳定选机）。spec §不做(YAGNI) 明确"不做机器
 * 健康自动探活/摘除"。真正的 codex 多机负载/健康均衡仍是 executor.js selectBestBridge 的
 * 现有职责；路由器通过 deps.selectLoadBalanced 注入可覆盖，把 bridge 探活的副作用挡在纯
 * 路由逻辑之外。将来要做负载/健康均衡时替换本函数体即可，签名不变。
 *
 * Spec: docs/superpowers/specs/2026-06-03-machine-executor-routing-design.md §单元2 半显式 + §不做(YAGNI)
 *
 * @param {Array} candidates  满足条件的 active 机器列表（调用方已按 name 排序，确定性）
 * @returns {Promise<Object|null>} 选中的机器（当前实现：第一台）
 */
export async function selectLoadBalancedMachine(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  // YAGNI：占位实现，确定性取第一台。不在本期做负载/健康探活。
  return candidates[0];
}
