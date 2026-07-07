/**
 * REVIEW_TASK_TYPES — 走本机 Codex CLI（非 cecelia-run）执行的审查类任务。
 *
 * 这些任务失败时不应计入 cecelia-run 熔断器，因为执行主体不是 cecelia-run。
 * SSOT：此文件。executor.js / callback-processor.js / routes/execution.js 均从此引用。
 */
export const REVIEW_TASK_TYPES = [
  'spec_review',
  'code_review_gate',
  'prd_review',
  'initiative_review',
  'code_review',
  'decomp_review',
  'initiative_plan',
  'initiative_verify',
  'arch_review',
  'architecture_design',
  'architecture_scan',
];
