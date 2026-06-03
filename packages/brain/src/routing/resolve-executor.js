/**
 * resolveExecutor — DB 驱动的「机器 + 执行器」统一路由器。
 *
 * 取代 executor.js 静态 MACHINE_REGISTRY + selectBestMachine 的职责。
 * 纯逻辑，DB 读取走可注入的 loadMachines()，便于单测。
 *
 * 解析顺序（spec §单元2）：
 *   1. 显式：payload.machine + payload.executor 都有 → 查 DB 该机器（active）→
 *      校验它 executors 里有该组合 → 返回。组合不存在/机器非 active → 抛 ExecutorRouteError
 *      （不静默改派，避免"我以为跑西安结果跑美国"）。
 *   2. 半显式：只给 machine → 用该机器 default executor；
 *             只给 executor → 在拥有该 executor 的 active 机器里按负载策略选一台。
 *   3. 能力标签默认：都没给 → TASK_REQUIREMENTS[task_type] 取标签 → 选满足标签的机器 →
 *      用其 default executor。
 *   4. 兜底：无匹配 → us-m4 / claude。
 *
 * 错误处理（spec §错误处理）：
 *   - 显式非法组合 → 抛 ExecutorRouteError（上层标 task failed + 清晰 reason）。
 *   - loadMachines 读取失败 → 降级到硬编码 us-m4/claude 兜底 + 告警（路由不能因 DB 抖动全挂）。
 *
 * Spec: docs/superpowers/specs/2026-06-03-machine-executor-routing-design.md
 */

import { loadActiveMachines } from './load-machines.js';
import { selectLoadBalancedMachine } from './select-load-balanced.js';

// 兜底路由：默认美国 M4 + Claude Code（用户规则 feedback memory）。
// id 用 'us-m4'（沿用旧 MACHINE_REGISTRY id），url 用本地 cecelia-bridge。
export const FALLBACK_ROUTE = Object.freeze({
  machineId: 'us-m4',
  executor: 'claude',
  url: process.env.EXECUTOR_BRIDGE_URL || 'http://localhost:3457',
});

/**
 * 路由失败错误：显式请求非法组合（机器无此 executor / 机器非 active / executor 无机器）。
 * 上层 catch 后把任务标 failed + 写清晰 reason，不偷偷改派。
 */
export class ExecutorRouteError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExecutorRouteError';
  }
}

// 从默认依赖注入表（生产用）。单测时整张 deps 注入假实现。
function defaultDeps() {
  return {
    loadMachines: loadActiveMachines,
    // 延迟 require 避免循环依赖（task-router 不 import routing）
    taskRequirements: undefined,
    selectLoadBalanced: selectLoadBalancedMachine,
  };
}

/** 找机器的 executors 数组（缺省空数组）。 */
function executorsOf(machine) {
  return (machine?.metadata?.executors) || [];
}

/** 找机器某 executor 的条目；找不到返回 null。 */
function findExecutorEntry(machine, executor) {
  return executorsOf(machine).find((e) => e.executor === executor) || null;
}

/** 找机器的 default executor 条目（标了 default:true 的；没有则取第一个）。 */
function defaultExecutorEntry(machine) {
  const list = executorsOf(machine);
  return list.find((e) => e.default) || list[0] || null;
}

/** 机器是否满足全部 required tags。 */
function machineHasTags(machine, requiredTags) {
  const tags = machine?.metadata?.tags || [];
  return requiredTags.every((t) => tags.includes(t));
}

/**
 * 解析任务的执行路由。
 *
 * @param {Object} task            含 task_type + payload（payload 可选 {machine, executor}）
 * @param {Object} [deps]          可注入依赖（单测用）
 * @param {Function} deps.loadMachines       () => Promise<machine[]>（active 机器）
 * @param {Object}   deps.taskRequirements   { [task_type]: string[] tags }
 * @param {Function} deps.selectLoadBalanced (candidates) => Promise<machine>（负载选一台）
 * @returns {Promise<{ machineId: string, executor: string, url: string }>}
 * @throws {ExecutorRouteError} 显式非法组合
 */
export async function resolveExecutor(task, deps = {}) {
  const merged = { ...defaultDeps(), ...deps };
  const { loadMachines, taskRequirements, selectLoadBalanced } = merged;

  const payload = task?.payload || {};
  const reqMachine = payload.machine || null;
  const reqExecutor = payload.executor || null;

  // DB 读取失败 → 降级兜底（路由不能因 DB 抖动全挂）。
  let machines;
  try {
    machines = await loadMachines();
  } catch (err) {
    console.warn(
      `[resolveExecutor] loadMachines 失败，降级 us-m4/claude 兜底: ${err.message}`,
    );
    return { ...FALLBACK_ROUTE };
  }

  const activeMachines = (machines || []).filter((m) => m.status === 'active');

  // ── 1. 显式：machine + executor 都有 ───────────────────────────────
  if (reqMachine && reqExecutor) {
    const machine = activeMachines.find((m) => m.name === reqMachine);
    if (!machine) {
      throw new ExecutorRouteError(
        `显式路由失败：机器 '${reqMachine}' 不存在或非 active`,
      );
    }
    const entry = findExecutorEntry(machine, reqExecutor);
    if (!entry) {
      throw new ExecutorRouteError(
        `显式路由失败：机器 '${reqMachine}' 未部署 executor '${reqExecutor}'`,
      );
    }
    return { machineId: machine.name, executor: entry.executor, url: entry.url };
  }

  // ── 2a. 半显式：只给 machine → 用该机器 default executor ───────────
  if (reqMachine && !reqExecutor) {
    const machine = activeMachines.find((m) => m.name === reqMachine);
    if (!machine) {
      throw new ExecutorRouteError(
        `半显式路由失败：机器 '${reqMachine}' 不存在或非 active`,
      );
    }
    const entry = defaultExecutorEntry(machine);
    if (!entry) {
      throw new ExecutorRouteError(
        `半显式路由失败：机器 '${reqMachine}' 无可用 executor`,
      );
    }
    return { machineId: machine.name, executor: entry.executor, url: entry.url };
  }

  // ── 2b. 半显式：只给 executor → 拥有该 executor 的 active 机器里负载选 ─
  if (!reqMachine && reqExecutor) {
    const candidates = activeMachines.filter((m) => findExecutorEntry(m, reqExecutor));
    if (candidates.length === 0) {
      throw new ExecutorRouteError(
        `半显式路由失败：无 active 机器部署 executor '${reqExecutor}'`,
      );
    }
    const chosen = await selectLoadBalanced(candidates, reqExecutor);
    const machine = chosen || candidates[0];
    const entry = findExecutorEntry(machine, reqExecutor);
    return { machineId: machine.name, executor: entry.executor, url: entry.url };
  }

  // ── 3. 能力标签默认：都没给 → TASK_REQUIREMENTS 标签 → 选满足机器 ──
  const requirements = taskRequirements || (await loadTaskRequirements());
  const requiredTags = requirements[task?.task_type] || [];
  const tagged = activeMachines.filter((m) => machineHasTags(m, requiredTags));

  if (tagged.length > 0) {
    const chosen = tagged.length === 1 ? tagged[0] : (await selectLoadBalanced(tagged) || tagged[0]);
    const entry = defaultExecutorEntry(chosen);
    if (entry) {
      return { machineId: chosen.name, executor: entry.executor, url: entry.url };
    }
  }

  // ── 4. 兜底：无匹配 → us-m4 / claude ──────────────────────────────
  return { ...FALLBACK_ROUTE };
}

/**
 * 延迟加载 TASK_REQUIREMENTS（避免顶层循环依赖）。
 * 生产默认从 task-router.js 取；找不到则空表（全走兜底）。
 */
async function loadTaskRequirements() {
  try {
    const mod = await import('../task-router.js');
    return mod.TASK_REQUIREMENTS || {};
  } catch {
    return {};
  }
}
