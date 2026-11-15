/**
 * 任务资源档位：按 task_type 返回内存、CPU 与超时配置。
 * quarantine 直接消费该映射，用于资源失败分类与恢复。
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
  harness_report: 'normal',   // loads journey history + decisions context; 512MB OOM risk
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
