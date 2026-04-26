task_id: e4b17f61-bff3-44b2-9613-d197698447a1
branch: cp-0426143729-fanout-node-fallback

## 任务标题

[Sprint 1.1] fanout node fallback — Planner 没输出 task_plan 时 graph 自己拆 sub_task

## 任务描述

Sprint 1 (#2640) E2E-v10 真实根因：Planner SKILL 没输出合规 task_plan →
`fanoutSubTasksNode` 看 `state.taskPlan?.tasks` 是空 → 直接走 `['join']` →
Final E2E 找不到 sub_task → fail。

本 PR 在 `harness-initiative.graph.js` 的 `dbUpsert` 与 `fanout` 之间插入
`inferTaskPlanNode`：幂等门 + spawn LLM fallback + 失败容错（不阻断 graph）。

## DoD

- [x] [ARTIFACT] `harness-initiative.graph.js` 已 export `inferTaskPlanNode`
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!/export async function inferTaskPlanNode/.test(c))process.exit(1)"

- [x] [ARTIFACT] `buildHarnessFullGraph` 含 `inferTaskPlan` 节点 + dbUpsert→inferTaskPlan→fanout edges
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!/addNode\('inferTaskPlan',\s*inferTaskPlanNode\)/.test(c))process.exit(1);if(!/addConditionalEdges\('dbUpsert',\s*stateHasError,\s*\{\s*error:\s*END,\s*ok:\s*'inferTaskPlan'\s*\}\)/.test(c))process.exit(1);if(!/addConditionalEdges\('inferTaskPlan',\s*stateHasError,\s*\{\s*error:\s*END,\s*ok:\s*'fanout'\s*\}\)/.test(c))process.exit(1)"

- [x] [BEHAVIOR] 单测：state 已有 tasks → inferTaskPlanNode 不调 executor，返回 {}
  Test: tests/inferTaskPlanNode-idempotent (packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js)

- [x] [BEHAVIOR] 单测：state.taskPlan.tasks 空 + 有 PRD → 调 LLM mock 后 state.taskPlan.tasks.length >= 1
  Test: tests/inferTaskPlanNode-fallback (packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js)

- [x] [BEHAVIOR] 单测：LLM exit=1 / 抛错 / parseTaskPlan 抛 / 无材料 → passthrough 不抛
  Test: tests/inferTaskPlanNode-tolerance (packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js)

- [x] [BEHAVIOR] 集成：full graph 跑完后 fanout 真派 Send 且 sub_tasks.length >= 1
  Test: tests/full-graph-fallback-e2e (packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js)

- [x] [ARTIFACT] Learning 文档存在
  Test: manual:node -e "require('fs').accessSync('docs/learnings/cp-0426143729-fanout-node-fallback.md')"

## 目标文件

- packages/brain/src/workflows/harness-initiative.graph.js
- packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js
- docs/learnings/cp-0426143729-fanout-node-fallback.md
- docs/superpowers/specs/2026-04-26-fanout-node-fallback-design.md
- docs/superpowers/plans/2026-04-26-fanout-node-fallback.md
- DoD.md

## 成功标准

- inferTaskPlanNode 在 fanout 前保证 state.taskPlan.tasks 非空
- 失败容错：fallback 自身失败不阻断 graph，让 join/final_e2e 走自然报告路径
- 23/23 测试通过（17 原有 + 6 新增），整个 workflows 92/92 pass
