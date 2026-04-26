/**
 * @deprecated Sprint 1: harness-watcher.js retired.
 *
 * processHarnessCiWatchers / processHarnessDeployWatchers 由 harness-task.graph 的
 * poll_ci / merge_pr 节点取代。tick-runner.js 已删 import + 调用。
 *
 * 此文件保留为标记文件 + 兜底空实现，让 HARNESS_USE_FULL_GRAPH=false 老路兼容
 * （legacy mode 下 tick worker 不再调用，但 import 不会炸）。
 *
 * 历史代码：git log --follow packages/brain/src/harness-watcher.js (从 main 看)
 */

export const RETIRED = true;

/** @deprecated 兜底空实现 */
export async function processHarnessCiWatchers() {
  return { processed: 0, ci_passed: 0, ci_failed: 0, ci_pending: 0, errors: 0, retired: true };
}

/** @deprecated 兜底空实现 */
export async function processHarnessDeployWatchers() {
  return { processed: 0, deploy_passed: 0, deploy_failed: 0, deploy_pending: 0, errors: 0, retired: true };
}
