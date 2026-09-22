/**
 * REVIEW_TASK_TYPES — 走本机 Codex CLI（非 cecelia-run）执行的审查类任务。
 *
 * 这些任务失败时不应计入 cecelia-run 熔断器，因为执行主体不是 cecelia-run。
 * SSOT：lib/task-type-registry.js 的 REVIEW_ISOLATION_TASK_TYPES 派生集合（本文件只保留模块路径，
 * 消费方 executor.js / callback-processor.js / routes/execution.js 均不动，import 路径不变）。
 *
 * 注意：与 actions.js 消费的 REVIEW_TASK_TYPES（family:review 标签派生，语义不同——多
 * review/qa/audit/codex_qa/codex_test_gen/pr_review/ci_patrol/staging_e2e/harness_evaluate/
 * harness_final_e2e 共 9 项、少 initiative_plan）是两份独立维护的东西，只搬家不合并，差异
 * 待主理人裁决，见 lib/task-type-registry.js 里 REVIEWISO 标签定义处注释。
 */
export { REVIEW_ISOLATION_TASK_TYPES as REVIEW_TASK_TYPES } from './task-type-registry.js';
