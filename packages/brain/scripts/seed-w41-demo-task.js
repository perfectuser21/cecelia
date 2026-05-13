/**
 * seed-w41-demo-task.js — W41 Walking Skeleton B19 演练任务注入脚本
 *
 * 功能：构造一个"第 1 轮 FAIL / 第 2 轮 PASS"的 harness 演练任务 payload，
 * 用于端到端验证 B19 fix_dispatch → fix_loop → final_evaluate 完整链路。
 *
 * 导出：
 *   buildDemoTaskPayload() → { task_type, title, payload }
 */

export function buildDemoTaskPayload() {
  return {
    task_type: 'harness_generate',
    title: 'W41 demo: playground GET /factorial (first round FAIL, second PASS)',
    payload: {
      sprint_dir: 'sprints/w41-walking-skeleton-final-b19',
      workstream_index: '1',
      workstream_count: '1',
      markerForFixLoop: true,
      contract_branch: 'cp-harness-propose-r2-4271d19c',
      planner_branch: 'cp-harness-propose-r2-4271d19c',
      description: 'Demo task designed to fail on round 1 and pass on round 2 to exercise the fix_dispatch loop.',
    },
  };
}
