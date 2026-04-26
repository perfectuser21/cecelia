/**
 * @deprecated Sprint 1: harness-phase-advancer.js retired.
 *
 * advanceHarnessInitiatives 由 buildHarnessFullGraph 顶层 graph 自己推进 phase 取代。
 * initiative_runs.phase 由 reportNode 写。tick-runner.js 已删 import + 调用。
 *
 * 此文件保留为兜底空实现，让 HARNESS_USE_FULL_GRAPH=false 老路依旧可 import。
 *
 * 历史代码：git log --follow packages/brain/src/harness-phase-advancer.js
 */

export const RETIRED = true;

/** @deprecated 兜底空实现 */
export async function advanceHarnessInitiatives() {
  return { advanced: 0, errors: [], retired: true };
}
