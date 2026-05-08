# Stream 4 — LangGraph 节点幂等门审计

## 背景

LangGraph durable execution 文档明确：节点重放（brain 重启从 PostgreSQL
checkpoint 恢复）会**重新执行节点头部代码**。Python 通过 `@task` 装饰器自动
缓存节点结果，但 JavaScript SDK（@langchain/langgraph）没有等价机制。

如果节点头部含外部副作用（spawn docker container / DB INSERT-UPDATE / git push），
重放会重复触发，导致：

- evaluator container 重复 spawn（费 LLM tokens + 浪费时长）
- initiative_runs.completed_at 反复刷新
- DB 写竞争 / 锁延长
- 副作用 N+1 累计

## 根本原因

**JavaScript LangGraph 节点不天然幂等**。必须每个 export node function 入口
手工加 short circuit `if (state.alreadyDone) return {};`。

具体到 harness-initiative.graph.js（v1.228.6 → 1.229.0）：

| 节点 | 副作用 | 重入条件（state field） |
|------|--------|------------------------|
| prepInitiativeNode | 创建 worktree + git fetch | state.worktreePath |
| runPlannerNode | spawn planner container | state.plannerOutput |
| parsePrdNode | 读 sprint-prd.md | state.taskPlan && state.prdContent |
| runGanLoopNode | spawn proposer/reviewer 多轮 | state.ganResult |
| dbUpsertNode | INSERT initiative_contracts/runs/subtasks | state.result?.contractId |
| inferTaskPlanNode | git fetch + git show | state.taskPlan?.tasks?.length >= 1 |
| runSubTaskNode | invoke sub-graph | (sub-graph 自己 thread_id 防重入) |
| joinSubTasksNode | 读 sub_tasks 决定 verdict | state.all_sub_tasks_done / verdict |
| reportNode | UPDATE initiative_runs | state.report_path |
| evaluateSubTaskNode | spawn evaluator container | state.evaluate_verdict |
| terminalFailNode | UPDATE initiative_runs failed | state.error?.node === 'terminal_fail' |
| finalEvaluateDispatchNode | spawn evaluator + interrupt() | state.final_e2e_verdict === 'PASS'/'PASS_WITH_OVERRIDE' |

豁免：

- **spawnGeneratorNode**：A1 重构留给 Layer 3，本节点当前 graph 不存在
- **advanceTaskIndexNode / retryTaskNode**：counter 节点，按设计每次 +1
- **fanoutSubTasksNode**：router（返 Send[]），不是 graph node
- **fanoutPassthroughNode**：直接 return {}，天然幂等

## 下次预防

- [x] 每个新加 node function 入口必须含 `if (alreadyDone) return {...}` short circuit
- [x] CI 跑 `packages/brain/scripts/audit/idempotency-check.sh` 强制审计
- [x] 单元测试 `idempotency-guards.test.js` 静态扫源码确保不被回退
- [ ] 后续 Layer 3 重构 spawnGeneratorNode 时同步加 short circuit + 移出豁免
- [ ] interrupt() 节点（finalEvaluateDispatchNode）的 FAIL 路径重放代价：
      LangGraph interrupt 协议要求重新执行节点头部，evaluator 会被 spawn 多次。
      若成本过高，考虑显式把 interrupt 拆成独立 node（before-interrupt / after-resume）。

## 改动清单

- 改 `packages/brain/src/workflows/harness-initiative.graph.js` 4 个节点入口
  （reportNode / evaluateSubTaskNode / terminalFailNode / finalEvaluateDispatchNode）
- 新建 `packages/brain/src/workflows/__tests__/idempotency-guards.test.js`（17 tests）
- 新建 `packages/brain/scripts/audit/idempotency-check.sh`（18/18 PASS）
- bump brain 1.228.6 → 1.229.0（package.json + package-lock.json + 根 package-lock.json + .brain-versions）

## 测试结果

- vitest src/workflows/__tests__/: 15 files / 157 tests 全过
- bash audit script: 18/18 PASS
