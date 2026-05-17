# Fanout Node Fallback — Planner 没输出 task_plan 时 graph 自己拆

**Brain Task**: `e4b17f61-bff3-44b2-9613-d197698447a1`
**Date**: 2026-04-26
**Sprint**: 1.1
**Status**: design approved

---

## 背景

Sprint 1 (#2640) 把 Phase B/C 接进 LangGraph 后，E2E-v10 验证：架构全对（17 checkpoints in DB, Phase A approved），但 `fanoutSubTasksNode` 看到 `state.taskPlan?.tasks` 是空 → 直接走 `["join"]` → Final E2E 找不到 sub-task → fail。

**根因**：Planner SKILL stdout 没输出 Brain 期望的 `task_plan` 字段（或格式不对），是 SKILL ↔ Brain 接缝问题。当前 graph 完全依赖 Planner 输出；若 Planner 没产出合规 plan，下游 fanout 没有 fallback。

---

## 目标

让 fanout node 不依赖 Planner SKILL 输出 — graph 自己保证有 sub_task：

1. 在 `dbUpsert` 之后、`fanout` 之前插入 `inferTaskPlanNode`
2. 该节点幂等：若 `state.taskPlan?.tasks?.length >= 1` → 直接 passthrough
3. 否则 fallback：用 `state.prdContent + state.ganResult.contract_content` 调一次 LLM（spawn docker，与 planner 同模式）拆 sub_task 数组，写回 `state.taskPlan`
4. fanout 始终能拿到 tasks → 派出 Send

---

## 非目标

- 不重写 `fanoutSubTasksNode`（保持当前 router 函数语义）
- 不修 Planner SKILL 自身（那是另一个 task）
- 不重新 upsert DB（fallback 拆出的 sub_task 仅写 state；sub-graph 不依赖 DB tasks 行）

---

## 架构

### Graph 拓扑变化

**改动前**：
```
START → prep → planner → parsePrd → ganLoop → dbUpsert → fanout → ...
```

**改动后**：
```
START → prep → planner → parsePrd → ganLoop → dbUpsert → inferTaskPlan → fanout → ...
```

### 新节点 `inferTaskPlanNode(state, opts?)`

```js
export async function inferTaskPlanNode(state, opts = {}) {
  // 幂等门：已有 tasks → passthrough
  const existing = state.taskPlan?.tasks;
  if (Array.isArray(existing) && existing.length >= 1) {
    return {};
  }

  const executor = opts.executor || spawn;
  const prdContent = state.prdContent || '';
  const contractContent = state.ganResult?.contract_content || '';
  if (!prdContent && !contractContent) {
    // 没材料可拆 → 不强行调 LLM，passthrough（fanout 走空路径）
    return {};
  }

  const prompt = `你是 task plan inferrer。根据下方 Sprint PRD + Contract，
拆 1-5 个独立可并行的 sub_task，每个 sub_task 是一个原子 PR 单位。
输出 task-plan.json，被 \`\`\`json ... \`\`\` 包裹，schema 见 harness-planner SKILL（task_id/title/scope/dod/files/depends_on/complexity/estimated_minutes）。

## PRD
${prdContent}

## Contract
${contractContent}`;

  let stdout;
  try {
    const result = await executor({
      task: { ...state.task, task_type: 'harness_planner' },
      prompt,
      worktreePath: state.worktreePath,
      env: {
        CECELIA_TASK_TYPE: 'harness_planner',
        HARNESS_NODE: 'infer_task_plan',
        HARNESS_INITIATIVE_ID: state.initiativeId,
        GITHUB_TOKEN: state.githubToken,
      },
    });
    if (result.exit_code !== 0 || result.timed_out) {
      // fallback 失败不阻断，passthrough（fanout 走空 → join → final_e2e FAIL）
      console.warn(`[infer_task_plan] LLM exit=${result.exit_code} timed_out=${result.timed_out}`);
      return {};
    }
    stdout = parseDockerOutput(result.stdout);
  } catch (err) {
    console.warn(`[infer_task_plan] spawn failed: ${err.message}`);
    return {};
  }

  let plan;
  try {
    plan = parseTaskPlan(stdout);
  } catch (err) {
    console.warn(`[infer_task_plan] parseTaskPlan failed: ${err.message}`);
    return {};
  }
  if (plan.initiative_id === 'pending' || !plan.initiative_id) {
    plan.initiative_id = state.initiativeId;
  }

  // 把 task_plan 行的字段（task_id/scope）映射成 sub_task 形态（id/title/description/payload）
  const subTasks = plan.tasks.map((t) => ({
    id: t.task_id,
    title: t.title,
    description: t.scope,
    payload: { dod: t.dod, files: t.files, depends_on: t.depends_on },
  }));

  return {
    taskPlan: { ...plan, tasks: subTasks },
  };
}
```

### Wiring 变化

`buildHarnessFullGraph()`：

- `.addNode('inferTaskPlan', inferTaskPlanNode)`
- `.addConditionalEdges('dbUpsert', stateHasError, { error: END, ok: 'inferTaskPlan' })`
- `.addEdge('inferTaskPlan', 'fanout')`

---

## 错误处理

| 场景 | 行为 |
|---|---|
| 已有 tasks (`length >= 1`) | passthrough，不调 LLM |
| 无 prdContent && 无 contract | passthrough，fanout 走空 → join FAIL |
| LLM 调用失败 (exit != 0) | warn + passthrough |
| LLM 输出无法 parse | warn + passthrough |
| LLM 输出合规 | 写回 `state.taskPlan` |

设计原则：**fallback 失败不阻断 graph**，让 join 自然走 FAIL 路径报告失败原因。

---

## 测试

新增 `inferTaskPlanNode` 单测覆盖：

1. `state.taskPlan.tasks.length >= 1` → 跳过，不调 executor（幂等）
2. tasks 为空 → mock executor 返回合规 task-plan.json → state.taskPlan.tasks.length >= 1
3. tasks 为空 + executor 返回 exit=1 → passthrough（不抛错）
4. tasks 为空 + executor 返回非 JSON → passthrough

集成层面：`buildHarnessFullGraph` e2e — Planner mock 返回不含 task_plan 的 stdout（导致 dbUpsert 后 state.taskPlan.tasks=[]）→ inferTaskPlanNode 用 mock executor 出 task-plan.json → fanout 派 Send → final_e2e 走通。

---

## 文件改动

| 文件 | 改动 |
|---|---|
| `packages/brain/src/workflows/harness-initiative.graph.js` | + `inferTaskPlanNode`, wire 进 graph |
| `packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js` | + 4 单测 + 1 e2e |

---

## 成功标准

- [ARTIFACT] `inferTaskPlanNode` 函数 export
- [ARTIFACT] `buildHarnessFullGraph()` 含 `inferTaskPlan` node + edges
- [BEHAVIOR] 单测 1: state 已有 tasks → 节点不调 executor
- [BEHAVIOR] 单测 2: state tasks 空 → 调 LLM 后 `state.taskPlan.tasks.length >= 1`
- [BEHAVIOR] 单测 3: LLM 失败 → 节点 passthrough 不抛
- [BEHAVIOR] 集成: full graph 跑完 fanout 真派 Send (sub_tasks > 0)

---

## 约束

- Brain 核心代码：本地 /dev，harness_mode=false
- foreground 阻塞 CI
- feat PR 必含测试
