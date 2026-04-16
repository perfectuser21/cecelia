/**
 * Harness LangGraph (skeleton)
 *
 * 替代 routes/execution.js + harness-watcher.js 中手写的 6 阶段状态机。
 * 节点：planner → proposer → reviewer → generator → evaluator → report
 * 条件边：
 *   - reviewer: APPROVED → generator, REVISION → proposer
 *   - evaluator: PASS → report, FAIL → generator
 *
 * 本骨架的节点函数为 placeholder（仅在 state 上写入轨迹），
 * Phase 1 docker-executor 完成后再接入真实 claude session 调用。
 *
 * 用法：
 *   import { buildHarnessGraph, compileHarnessApp } from './harness-graph.js';
 *   const app = compileHarnessApp({ checkpointer });
 *   for await (const ev of app.stream(initialState, { configurable: { thread_id: taskId } })) { ... }
 */

import { StateGraph, START, END, Annotation, MemorySaver } from '@langchain/langgraph';

/**
 * Harness 状态 schema
 *
 * 字段说明（全部可选）：
 *  - task_id           关联的 Brain 任务 ID（也用作 langgraph thread_id）
 *  - task_description  原始用户需求
 *  - sprint_dir        sprints/ 目录
 *  - prd_content       Layer 1 planner 输出
 *  - contract_content  Layer 2a proposer 输出
 *  - review_verdict    Layer 2b reviewer 裁决：'APPROVED' | 'REVISION'
 *  - review_round      review 回合计数（防止 evaluator/reviewer 死循环时排查用）
 *  - pr_url            Layer 3 generator 输出
 *  - evaluator_verdict Layer 3c evaluator 裁决：'PASS' | 'FAIL'
 *  - eval_round        evaluator 回合计数
 *  - report_path       Layer 4 report 输出
 *  - trace             节点执行轨迹（debug 用，reducer 累加）
 */
export const HarnessState = Annotation.Root({
  task_id: Annotation,
  task_description: Annotation,
  sprint_dir: Annotation,
  prd_content: Annotation,
  contract_content: Annotation,
  review_verdict: Annotation,
  review_round: Annotation,
  pr_url: Annotation,
  evaluator_verdict: Annotation,
  eval_round: Annotation,
  report_path: Annotation,
  trace: Annotation({
    reducer: (left, right) => {
      const a = Array.isArray(left) ? left : [];
      const b = Array.isArray(right) ? right : (right ? [right] : []);
      return [...a, ...b];
    },
    default: () => [],
  }),
});

/**
 * Placeholder node factory.
 * Phase 1 之后会替换成真正调 docker-executor 的实现。
 *
 * @param {string} label                    节点名（写入 trace）
 * @param {(state) => object} [stateUpdate] 可选：节点附加到 state 上的字段
 * @returns {(state) => Promise<object>}
 */
export function placeholderNode(label, stateUpdate) {
  return async (state) => {
    const update = typeof stateUpdate === 'function' ? (stateUpdate(state) || {}) : {};
    return { ...update, trace: label };
  };
}

/**
 * 构造 harness graph（未编译）。
 *
 * 暴露未编译的 builder，让测试可以注入自定义节点
 * 来覆盖条件边路径，不必真正调用 Phase 1 docker-executor。
 *
 * @param {object} [overrides]   节点 override map: { planner, proposer, ... }
 * @returns {StateGraph}         未编译的 StateGraph 实例
 */
export function buildHarnessGraph(overrides = {}) {
  const nodes = {
    planner: overrides.planner || placeholderNode('planner'),
    proposer: overrides.proposer || placeholderNode('proposer'),
    reviewer: overrides.reviewer || placeholderNode('reviewer', () => ({ review_verdict: 'APPROVED' })),
    generator: overrides.generator || placeholderNode('generator'),
    evaluator: overrides.evaluator || placeholderNode('evaluator', () => ({ evaluator_verdict: 'PASS' })),
    report: overrides.report || placeholderNode('report'),
  };

  const graph = new StateGraph(HarnessState)
    .addNode('planner', nodes.planner)
    .addNode('proposer', nodes.proposer)
    .addNode('reviewer', nodes.reviewer)
    .addNode('generator', nodes.generator)
    .addNode('evaluator', nodes.evaluator)
    .addNode('report', nodes.report)
    .addEdge(START, 'planner')
    .addEdge('planner', 'proposer')
    .addEdge('proposer', 'reviewer')
    .addConditionalEdges(
      'reviewer',
      (state) => (state.review_verdict === 'APPROVED' ? 'generator' : 'proposer'),
      { generator: 'generator', proposer: 'proposer' },
    )
    .addEdge('generator', 'evaluator')
    .addConditionalEdges(
      'evaluator',
      (state) => (state.evaluator_verdict === 'PASS' ? 'report' : 'generator'),
      { report: 'report', generator: 'generator' },
    )
    .addEdge('report', END);

  return graph;
}

/**
 * 编译 graph 为可调用 app。
 *
 * @param {object}  [opts]
 * @param {object}  [opts.overrides]    传给 buildHarnessGraph
 * @param {object}  [opts.checkpointer] BaseCheckpointSaver；不传则用 MemorySaver
 */
export function compileHarnessApp({ overrides, checkpointer } = {}) {
  const graph = buildHarnessGraph(overrides);
  const saver = checkpointer || new MemorySaver();
  return graph.compile({ checkpointer: saver });
}

// 节点名常量（runner / 测试 / observability 共用）
export const HARNESS_NODE_NAMES = ['planner', 'proposer', 'reviewer', 'generator', 'evaluator', 'report'];
