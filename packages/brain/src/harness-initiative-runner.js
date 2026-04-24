/**
 * harness-initiative-runner.js — v2 Phase C4 shim.
 *
 * 真实逻辑已搬到 `./workflows/harness-initiative.graph.js`。本文件保留为 re-export shim
 * 兼容老 caller（executor.js / harness-phase-advancer.js / harness-final-e2e.js 等）的 import 路径。
 *
 * Phase C6/C7 真接线 runWorkflow 后此 shim 可删。
 *
 * 见 docs/design/brain-orchestrator-v2.md §6 Phase C 路线图。
 */
export * from './workflows/harness-initiative.graph.js';
