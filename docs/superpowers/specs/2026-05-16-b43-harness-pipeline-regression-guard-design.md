# B43 — Harness Pipeline A→B→C Regression Guard 设计

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 harness pipeline 全链路（Phase A GAN → Phase B Generator → Phase C Evaluator）写 regression guard，防止 B40/B41/B42 类问题修好之后又悄悄坏掉。

**Architecture:** 两层保护：(1) vitest 集成测试，用 `nodeOverrides` 注入 mock 节点运行完整状态机；(2) smoke shell 脚本，静态验证拓扑 + routing 函数级别 sanity check。

**Tech Stack:** vitest、LangGraph MemorySaver、Node.js ESM、bash

---

## 背景与根因

B40/B41/B42 修复后，pipeline 首次端到端 PASS（task `d6ea1ffe`，`final_e2e_verdict='PASS'`）。

现有测试覆盖现状：
- 大量单节点 unit test（B42、B40、B39、GAN convergence 等）
- 大量 smoke（各组件独立验证）
- **`harness-initiative.graph.full.test.js` 中 3 个关键 e2e 测试全是 `it.skip`（标注 `LAYER_3_SMOKE_COVERED`）**

跳过的原因：`runSubTaskNode` 内部调用 harness-task 子图，子图使用 spawn-and-interrupt 架构（Docker detached + 等 callback POST），单进程 vitest 无法模拟 callback router resume。

**后果：Phase B→C 的状态机转移（`pick_sub_task → run_sub_task → advance → pick_sub_task(loop) → final_evaluate → report`）完全没有自动化保护。**

---

## 设计

### 1. 最小生产代码改动：`buildHarnessFullGraph` 加 `nodeOverrides`

**文件：** `packages/brain/src/workflows/harness-initiative.graph.js`

```js
export function buildHarnessFullGraph(nodeOverrides = {}) {
  const {
    runSubTaskFn = runSubTaskNode,
    finalEvaluateFn = finalEvaluateDispatchNode,
  } = nodeOverrides;

  return new StateGraph(FullInitiativeState)
    ...
    .addNode('run_sub_task', runSubTaskFn, { retryPolicy: LLM_RETRY })
    .addNode('final_evaluate', finalEvaluateFn, { retryPolicy: LLM_RETRY })
    ...
}
```

**注意：**
- `compileHarnessFullGraph()` 调用 `buildHarnessFullGraph()` 不传参，默认值解构出原始函数，生产行为完全不变。
- `harness-interrupts.js` 走 `compileHarnessFullGraph()`，同样不受影响。

### 2. Vitest 集成测试

**文件：** `packages/brain/src/workflows/__tests__/harness-pipeline-b43-integration.test.js`

**测试场景：Happy path A→B→C，1 个 workstream**

```
ganLoop → inferTaskPlan → dbUpsert → pick_sub_task(ws1) →
run_sub_task(mock: merged) → advance → pick_sub_task(done) →
final_evaluate(mock: PASS) → report
```

**Mock 设置：**

```js
const mockRunSubTaskFn = vi.fn(async (state) => ({
  sub_tasks: [{ id: state.sub_task?.id, status: 'merged', pr_url: 'https://github.com/fake/pr/1' }]
}));

const mockFinalEvaluateFn = vi.fn(async () => ({
  final_e2e_verdict: 'PASS',
  final_e2e_failed_scenarios: [],
}));
```

**关键实现注意事项：**

1. `runSubTaskNode` 返回格式必须用 `state.sub_task?.id`（不能硬编码 'ws1'），因为 `sub_tasks` 的 Annotation reducer 是 `mergeBy id`。

2. `finalEvaluateDispatchNode` 头部有幂等短路（若 state 已含 `final_e2e_verdict='PASS'` 直接 return）。初始 invoke state 不得含 `final_e2e_verdict` 字段。

3. 需要 mock 的依赖（复用 `harness-initiative.graph.full.test.js` 的 vi.hoisted 模式）：
   - `pool`（DB）：mockPool with mockClient
   - `ensureHarnessWorktree`
   - `resolveGitHubToken`
   - `runGanLoopNode` / `runPlannerNode`（Phase A LLM 节点）

4. Checkpointer 用 MemorySaver（内存，无需 Postgres）。

**断言：**
- `stream` 输出的 node 更新序列包含所有预期节点
- 最终 state 的 `final_e2e_verdict === 'PASS'`
- `final_e2e_failed_scenarios` 为空数组
- `mockFinalEvaluateFn` 被调用 1 次（验证 final_evaluate 节点确实执行）
- `mockRunSubTaskFn` 被调用 1 次（验证 run_sub_task 节点确实执行）

### 3. Smoke Shell Script

**文件：** `packages/brain/scripts/smoke/b43-harness-pipeline-e2e-smoke.sh`

```bash
#!/usr/bin/env bash
# b43-harness-pipeline-e2e-smoke.sh
# 验证 harness pipeline 全链路 regression guard 的三层静态检查
set -euo pipefail
```

**Case 1（静态）：graph 函数存在且支持 nodeOverrides**
```bash
node --input-type=module << 'JS'
import { buildHarnessFullGraph } from '...';
const g = buildHarnessFullGraph({ runSubTaskFn: async () => ({}) });
if (!g) throw new Error('buildHarnessFullGraph returned null');
JS
```

**Case 2（静态）：routeFromPickSubTask 路由逻辑正确**
```bash
node --input-type=module << 'JS'
import { routeFromPickSubTask } from '...';
// idx >= tasks.length → 'final_evaluate'
const r = routeFromPickSubTask({ taskPlan: { tasks: ['t1'] }, task_loop_index: 1 });
if (r !== 'final_evaluate') throw new Error(`Expected final_evaluate, got ${r}`);
// idx < tasks.length → 'run_sub_task'
const r2 = routeFromPickSubTask({ taskPlan: { tasks: ['t1'] }, task_loop_index: 0 });
if (r2 !== 'run_sub_task') throw new Error(`Expected run_sub_task, got ${r2}`);
JS
```

**Case 3（静态）：compileHarnessFullGraph 导出存在**
```bash
grep -q 'export async function compileHarnessFullGraph' packages/brain/src/workflows/harness-initiative.graph.js
```

**Case 4（软，Brain 运行时）：initiative_runs 表可访问**
- Brain 不运行 → SKIP（exit 0），不 fail
- Brain 运行 → psql 查 `initiative_runs` 表结构验证关键列存在

---

## 测试策略

这是一个测试任务本身，自验证方式：

| 层级 | 验证方式 | 覆盖范围 |
|------|----------|----------|
| Integration test | `npm test` 对应文件 | A→B→C 状态机完整转移、final_e2e_verdict=PASS 聚合 |
| Smoke Case 1 | node import + 调用 | buildHarnessFullGraph nodeOverrides 可用 |
| Smoke Case 2 | routeFromPickSubTask 纯函数调用 | pick_sub_task routing 不回归 |
| Smoke Case 3 | grep | compileHarnessFullGraph 导出存在 |
| Smoke Case 4 | psql (soft) | initiative_runs 表结构 |

CI 集成：
- 集成测试被 `brain-ci.yml` 的 vitest job 自动捡起
- smoke 被 `real-env-smoke` job 自动捡起

---

## 回归保护范围

| 场景 | 是否被保护 |
|------|-----------|
| 有人删除 `addEdge('dbUpsert', 'pick_sub_task')` | ✅ Integration test 会报错（run_sub_task 不被调用） |
| 有人改 `routeFromPickSubTask` 逻辑 | ✅ Smoke Case 2 + Integration test |
| 有人改 `finalEvaluateDispatchNode` 导出名 | ✅ Smoke Case 1（import 失败） |
| B42 类 propose_branch mismatch 再次 throw | ✅ harness-gan-b42.test.js（已有） |
| B40 类 .brain-result.json 读取 | ✅ harness-task-b40-brain-result-fallback.test.js（已有） |
| 真实 LLM 输出质量下降 | ❌ 需要真实 E2E（超出本 ticket 范围） |
