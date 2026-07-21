/**
 * Capacity - 基于服务器实际资源的动态容量管控
 *
 * 以 CPU 和 Memory 的 80% 为上限，动态计算最大并行数。
 * 所有并行数引用此文件，统一来源。
 *
 * 资源模型：
 *   - 统一按 MEM_PER_TASK_MB_DEFAULT=400MB / 0.5 core 估算（排班粗算用）
 *   - 实际内存由容器 cgroup 硬顶执行时兜底（超限 OOM 自动升配），不做 task_type 细分估算
 *   保留 20% 系统余量，保留 2 seat 给用户交互
 */

import os from 'os';

const MEM_PER_TASK_MB_DEFAULT = 400; // 每并行流内存估算（排班粗算用）
// 按 task_type 细分的估算表已删除（2026-07-21 decision 4186b574）：
// 旧表是 LangGraph「每 phase 一个 Brain task」时代的遗物（harness_generator 等键
// 在现架构 30 天 task_type 分布中零出现），且所有调用方从未传过 taskType，
// 该表从未生效。现架构（harness_initiative 单 session relay）的内存由容器
// cgroup 硬顶执行时兜底（默认 1G，OOM 自动升 4G——刀A7），排班估算统一用默认值。
const CPU_PER_TASK = 0.5;       // ~0.5 core avg per claude process（保守估算）
const TARGET_UTILIZATION = 0.8; // 80% — 留 20% 给系统
const USER_RESERVE = 2;         // 保留 2 seat 给用户交互
const MAX_PHYSICAL_CAP = 20;    // 硬顶：与 platform-utils.js 保持一致

/**
 * 基于服务器实际 CPU + Memory 计算最大并行流数。
 * 取 CPU 和 Memory 的短板，乘 80%，减去用户保留。
 * 最终结果不超过 MAX_PHYSICAL_CAP 硬顶，防止备用路径绕过上限。
 */
export function getMaxStreams() {
  const cpuCount = os.cpus().length;
  const totalMemMB = Math.round(os.totalmem() / 1024 / 1024);

  const byCpu = Math.floor(cpuCount * TARGET_UTILIZATION / CPU_PER_TASK);
  const byMem = Math.floor(totalMemMB * TARGET_UTILIZATION / MEM_PER_TASK_MB_DEFAULT);

  // 取短板，减用户保留，最少 1，不超过硬顶
  return Math.min(MAX_PHYSICAL_CAP, Math.max(1, Math.min(byCpu, byMem) - USER_RESERVE));
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
