/**
 * Capacity - 基于服务器实际资源的动态容量管控
 *
 * 以 CPU 和 Memory 的 80% 为上限，动态计算最大并行数。
 * 所有并行数引用此文件，统一来源。
 *
 * 资源模型（基于 docker-executor.js RESOURCE_TIERS + 实测数据）：
 *   - 默认 / dev / harness / propose：~400MB / 0.5 core（原估算）
 *   - content_research / content_copywrite：~2048MB / 1 core（Claude CLI + 长 prompt，实测 800-1100MB 峰值）
 *   - content_generate：~1536MB / 2 cores（SVG napi 渲染 9 PNG）
 *   保留 20% 系统余量，保留 2 seat 给用户交互
 */

import os from 'os';

// 每个任务的内存消耗（跟 docker-executor.js RESOURCE_TIERS 对齐）
const MEM_PER_TASK_MB_DEFAULT = 400;    // 默认小任务（propose / review / eval / fix / talk）
const MEM_PER_TASK_MB_BY_TYPE = {
  // content pipeline（2048MB tier）
  content_research: 2048,
  content_copywrite: 2048,
  // heavy tier（1536MB）
  content_generate: 1536,
  dev: 1536,
  codex_dev: 1536,
  generate: 1536,
  sprint_generator: 1536,
  harness_generator: 1536,
  initiative_plan: 1536,
  // normal tier（1024MB）
  content_copy_review: 1024,
  content_image_review: 1024,
  // light tier（512MB）
  content_export: 512,
  planner: 512,
  sprint_planner: 512,
  harness_planner: 512,
  report: 512,
  sprint_report: 512,
  harness_report: 512,
  daily_report: 512,
  briefing: 512,
};
const CPU_PER_TASK = 0.5;       // ~0.5 core avg per claude process（保守估算）
const TARGET_UTILIZATION = 0.8; // 80% — 留 20% 给系统
const USER_RESERVE = 2;         // 保留 2 seat 给用户交互
const MAX_PHYSICAL_CAP = 20;    // 硬顶：与 platform-utils.js 保持一致

/**
 * 根据 task_type 估算单任务内存消耗（MB）。
 * 用于 getMaxStreams + 调度决策。docker-executor.js 做实际硬限。
 * @param {string} [taskType] — 不传或未注册的 type 返回默认 400MB
 * @returns {number} 预估内存 MB
 */
export function estimateMemPerTask(taskType) {
  if (!taskType) return MEM_PER_TASK_MB_DEFAULT;
  return MEM_PER_TASK_MB_BY_TYPE[taskType] ?? MEM_PER_TASK_MB_DEFAULT;
}

/**
 * 基于服务器实际 CPU + Memory 计算最大并行流数。
 * 取 CPU 和 Memory 的短板，乘 80%，减去用户保留。
 * 最终结果不超过 MAX_PHYSICAL_CAP 硬顶，防止备用路径绕过上限。
 *
 * @param {string} [taskType] — 可选，按具体 task_type 估算并行数（默认按 400MB 估 dev/harness 小任务）
 */
export function getMaxStreams(taskType) {
  const cpuCount = os.cpus().length;
  const totalMemMB = Math.round(os.totalmem() / 1024 / 1024);
  const memPerTask = estimateMemPerTask(taskType);

  const byCpu = Math.floor(cpuCount * TARGET_UTILIZATION / CPU_PER_TASK);
  const byMem = Math.floor(totalMemMB * TARGET_UTILIZATION / memPerTask);

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
