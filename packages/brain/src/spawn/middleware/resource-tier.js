/**
 * resource-tier middleware — Brain v2 Layer 3 attempt-loop 内循环第 c 步。
 * 见 docs/design/brain-orchestrator-v2.md §5.2。
 *
 * 职责：按 task_type 返回 docker 容器的内存/CPU tier 配置。
 *
 * v2 P2 PR 7（本 PR）：纯代码搬家，从 docker-executor.js:47-93 抽出。
 * docker-executor.js 通过 re-export 保留 resolveResourceTier，兼容外部 caller
 * （executor.js:3735 + docker-executor.test.js）。
 */

/**
 * 资源档位配置
 *   light  : 512 MB / 1 core   / 30 min  — planner / report / 短链 LLM 调用
 *   normal : 1   GB / 1 core   / 90 min  — propose / review / eval / fix
 *   heavy  : 1.5 GB / 2 cores  / 120 min — generate / dev（写代码 + git/CI）
 *   pipeline-heavy : 2 GB / 1 core / 180 min — content pipeline 峰值 1100 MB + 2× 冗余
 *
 * timeoutMs 用于 docker-executor SIGKILL 兜底，per-tier 让重任务跑久点不被秒杀。
 * Harness v6 P1-E（brain task 3f32212a-adc2-436b-b828-51820a2379e6）。
 */
export const RESOURCE_TIERS = {
  light:            { memoryMB: 512,  cpuCores: 1, timeoutMs: 30  * 60 * 1000 },
  normal:           { memoryMB: 1024, cpuCores: 1, timeoutMs: 90  * 60 * 1000 },
  heavy:            { memoryMB: 1536, cpuCores: 2, timeoutMs: 120 * 60 * 1000 },
  'pipeline-heavy': { memoryMB: 2048, cpuCores: 1, timeoutMs: 180 * 60 * 1000 },
};

export const TASK_TYPE_TIER = {
  // light
  planner: 'light',
  sprint_planner: 'light',
  report: 'light',
  sprint_report: 'light',
  harness_report: 'light',
  daily_report: 'light',
  briefing: 'light',
  content_export: 'light',
  // normal
  content_copy_review: 'normal',
  content_image_review: 'normal',
  // heavy
  dev: 'heavy',
  codex_dev: 'heavy',
  generate: 'heavy',
  content_generate: 'heavy',
  sprint_generator: 'heavy',
  harness_generator: 'heavy',
  initiative_plan: 'heavy',
  // pipeline-heavy
  content_research: 'pipeline-heavy',
  content_copywrite: 'pipeline-heavy',
  harness_planner:          'pipeline-heavy',   // Opus prompt cache > 1M token, OOM at 512m (migration 270)
  harness_contract_propose: 'pipeline-heavy',   // Opus tier
  harness_contract_review:  'pipeline-heavy',   // Opus tier
  // 其他默认 normal
};

/**
 * 根据 task_type 解析资源档位
 * @param {string} taskType
 * @returns {{memoryMB:number, cpuCores:number, tier:string}}
 */
export function resolveResourceTier(taskType) {
  const tier = TASK_TYPE_TIER[taskType] || 'normal';
  const spec = RESOURCE_TIERS[tier];
  return { ...spec, tier };
}
