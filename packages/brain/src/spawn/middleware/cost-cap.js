/**
 * cost-cap middleware — Brain v2 Layer 3 外层（Koa 洋葱）的预算守卫。
 * 见 docs/design/brain-orchestrator-v2.md §5.2。
 *
 * 职责：spawn 入口查 budget，若超 budget 抛错拒绝 spawn，防止超预算 task 失控烧钱。
 * budget 来源：ctx.deps.getBudget(taskType) 或默认无限制。
 *
 * v2 P2 PR 9（本 PR）：建立模块 + 单测，暂不接线 executeInDocker。
 * 未来外层整合 PR 在 spawn() 入口调 checkCostCap。
 *
 * 预算维度（v1 最简）：
 *   - per-task 预算：ctx.deps.getBudget(taskType) 返回 { usd: N, usage_usd: M }
 *   - 若 usage_usd >= usd（超/等于预算），抛 CostCapExceededError
 *   - 若 deps 未提供或返回 null，视为无限制放行
 *
 * @param {object} opts   { task: { task_type } }
 * @param {object} ctx    { deps? } — 测试注入 { getBudget }
 * @returns {Promise<void>} 通过返回 void，失败抛错
 */
export class CostCapExceededError extends Error {
  constructor(taskType, usage, limit) {
    super(`[cost-cap] ${taskType} budget exceeded: $${usage.toFixed(2)} >= $${limit.toFixed(2)}`);
    this.name = 'CostCapExceededError';
    this.taskType = taskType;
    this.usage = usage;
    this.limit = limit;
  }
}

export async function checkCostCap(opts, ctx = {}) {
  const taskType = opts?.task?.task_type;
  if (!taskType) return;
  const getBudget = ctx.deps?.getBudget;
  if (!getBudget) return; // 无 deps → 无限制
  const budget = await getBudget(taskType);
  if (!budget || typeof budget.usd !== 'number') return;
  const usage = typeof budget.usage_usd === 'number' ? budget.usage_usd : 0;
  if (usage >= budget.usd) {
    throw new CostCapExceededError(taskType, usage, budget.usd);
  }
}
