/**
 * Capacity - 基于服务器实际资源的动态容量管控
 *
 * 以 CPU 和 Memory 的 80% 为上限，动态计算最大并行数。
 * 所有并行数引用此文件，统一来源。
 *
 * 资源模型（来自 executor.js 观测值）：
 *   每个 Claude 无头进程约需 500MB 内存 + 0.5 核 CPU
 *   保留 20% 系统余量，保留 2 seat 给用户交互
 */

import os from 'os';

// 每个任务的资源消耗（基于 executor.js 观测值）
const MEM_PER_TASK_MB = 500;    // ~500MB avg per claude process
const CPU_PER_TASK = 0.5;       // ~0.5 core avg per claude process
const TARGET_UTILIZATION = 0.8; // 80% — 留 20% 给系统
const USER_RESERVE = 2;         // 保留 2 seat 给用户交互

/**
 * 基于服务器实际 CPU + Memory 计算最大并行流数。
 * 取 CPU 和 Memory 的短板，乘 80%，减去用户保留。
 */
export function getMaxStreams() {
  const cpuCount = os.cpus().length;
  const totalMemMB = Math.round(os.totalmem() / 1024 / 1024);

  const byCpu = Math.floor(cpuCount * TARGET_UTILIZATION / CPU_PER_TASK);
  const byMem = Math.floor(totalMemMB * TARGET_UTILIZATION / MEM_PER_TASK_MB);

  // 取短板，减用户保留，最少 1
  return Math.max(1, Math.min(byCpu, byMem) - USER_RESERVE);
}

/**
 * 从动态 slots 数量计算各层级的容量限制。
 * 兼容旧接口，decomp-checker 仍调用此函数。
 *
 * @param {number} [slots] - 可选覆盖值，默认使用 getMaxStreams()
 * @returns {Object} 各层级容量配置
 */
export function computeCapacity(slots) {
  const s = Math.max(1, Math.floor(slots ?? getMaxStreams()));

  return {
    slots: s,

    project: {
      max: Math.min(2, Math.ceil(s / 2)),
      softMin: 1,
      cooldownMs: 180_000,
    },

    initiative: {
      max: s,
      softMin: Math.ceil(s / 3),
      cooldownMs: 120_000,
    },

    task: {
      queuedCap: s * 3,
      softMin: s,
      cooldownMs: 60_000,
    },
  };
}

/**
 * 检查某个层级是否已达容量上限。
 */
export function isAtCapacity(currentActive, max) {
  return currentActive >= max;
}

// 向后兼容
export const MAX_ACTIVE_PROJECTS = 2;
