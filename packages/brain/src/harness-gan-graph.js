/**
 * harness-gan-graph.js — v2 Phase C3 shim.
 *
 * 真实逻辑已搬到 `./workflows/harness-gan.graph.js`。本文件保留为 re-export shim
 * 兼容老 caller（harness-initiative-runner.js 等）的 import 路径。
 *
 * Phase C4 harness-initiative 搬家时 caller 会改 import 到新位置，届时此 shim 可删。
 *
 * 见 docs/design/brain-orchestrator-v2.md §6 Phase C 路线图。
 */
export * from './workflows/harness-gan.graph.js';
