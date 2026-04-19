# PRD: Harness v2 M2 — Initiative Planner 重写 + DAG 调度

## 背景

Harness v2 PRD（`docs/design/harness-v2-prd.md`）已经把 v1 的 4 个结构偏差拆成 6 个 milestone。M1（PR #2439）落了三张新表 + 3 个 task_type。M2 要继续把"Initiative 级一次性规划"落到代码：

- 新的 Planner SKILL.md 不再只产 PRD，而是同时产 `task-plan.json` 含 Task DAG
- Brain 层需要 DAG 调度器：拓扑排序 + 环检测 + 入库 + 下一个可运行 Task 查询
- 需要 Initiative Runner 串起"调 Planner → 解析 → 入库 → 建合同草稿 + Run"

v1 的 LangGraph 路径（`harness_planner` 任务）保留不动，向后兼容老数据。

## 目标

1. **harness-planner SKILL.md 升级到 v6.0.0**：输出 sprint-prd.md + task-plan.json（严格 schema，4-5 Task，每 20-60 min）
2. **新建 `packages/brain/src/harness-dag.js`**：导出 parseTaskPlan / detectCycle / topologicalOrder / upsertTaskPlan / nextRunnableTask
3. **新建 `packages/brain/src/harness-initiative-runner.js`**：runInitiative(task) 入口
4. **改 `packages/brain/src/executor.js`**：加 `harness_initiative` 分支，保留旧 `harness_planner`
5. **覆盖测试**：harness-dag 单测 + Runner integration test（mock Docker + 真 PG）

## 非目标

- 不改 Proposer / Reviewer / Generator / Evaluator（M3/M4）
- 不删 v1 LangGraph 路径（兼容保留）
- 不跑真实 Initiative E2E（本 M2 单元+集成即可）
- 不做 Dashboard 可视化（M6）
- 不实现预算熔断 / 超时检查 tick（M5）—— M2 只写入 deadline_at

## User Stories

- **作为** Harness v2 用户，**我要** Planner 输出带 DAG 的 task-plan.json，**以便** 后续 Generator 按拓扑序取任务
- **作为** Brain 执行器，**我要** 能拒绝非法 task-plan（缺字段/有环/越上限），**以便** 不把坏数据写进 DB
- **作为** tick 调度器，**我要** 查"下一个可运行 task"高效（单条 SQL），**以便** Initiative 阶段 B 循环低延迟

## 给开发者的变更清单

- `packages/brain/src/harness-dag.js` 新增：5 个导出函数 + Kahn 算法 + DFS 环检测
- `packages/brain/src/harness-initiative-runner.js` 新增：runInitiative(task) 调 Docker Planner + 事务入库
- `packages/brain/src/executor.js`：加 2.85 分支 `harness_initiative → runInitiative`
- `packages/brain/src/__tests__/harness-dag.test.js` 新增：27 个单测
- `packages/brain/src/__tests__/integration/harness-initiative-runner.integration.test.js` 新增：4 个集成测试（真 PG）
- `packages/workflows/skills/harness-planner/SKILL.md` 改 v6.0.0
- `~/.claude-account{1,2}/skills/harness-planner/SKILL.md` + `~/.claude/skills/harness-planner/SKILL.md` 同步
- `packages/brain/package.json` + `package-lock.json` + `.brain-versions` 同步 bump 到 1.219.0

## Schema 注意

PRD v2 §4.5 原定把 harness_task 行的 `parent_task_id`、`pr_plans` 双写。但真实 schema：
- `tasks` 表没有 `parent_task_id` 字段（PRD 与实际不符）
- `pr_plans` 表锚定 `project_id`，没有 `task_id` 字段（schema 不匹配 task 级语义）

M2 采用的折中方案：
- parent 关系写到 `tasks.payload.parent_task_id`（字符串 UUID）
- 依赖 `task_dependencies` 边表做拓扑查询（`payload->>'parent_task_id' = $1`）
- 不写 `pr_plans`（留后续 milestone 做 schema 对齐时补）

对 M2 本身完整可用，不阻塞 M3/M4。

## 成功标准

1. `packages/brain/src/harness-dag.js` 存在且导出 5 个函数（parseTaskPlan/detectCycle/topologicalOrder/upsertTaskPlan/nextRunnableTask）
2. `parseTaskPlan` 在 27 个单测用例下全部正确（接受合法 / 拒非法 JSON / 拒缺字段 / 拒环 / 拒越上限）
3. `runInitiative(task)` 在 4 个集成用例下全部正确（happy path / Docker 失败不写 DB / parseTaskPlan 失败不写 DB / nextRunnableTask 按依赖顺序返回）
4. `executor.js` 含 `task.task_type === 'harness_initiative'` 分支
5. harness-planner SKILL.md 含 `task-plan.json` code fence 模板
6. 版本同步（package.json / package-lock.json / .brain-versions 均为 1.219.0）
