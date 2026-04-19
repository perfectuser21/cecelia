# Learning: Harness v2 M2 — Planner + DAG 调度

日期: 2026-04-19
分支: cp-04192301-harness-v2-m2
PR 关联: Harness v2 M2（接续 PR #2439）

## 背景

M2 的目标是把 v2 阶段 A（Initiative 一次性规划）落地。实施过程中发现 PRD §4.5 关于 schema 的描述与实际 DB 不一致。

## 根本原因

1. **PRD 假设的 schema 与实际不符**
   - PRD §4.5：`tasks.parent_task_id 已存在 → harness_task 的 parent 指 harness_initiative`
   - 实际：`tasks` 表从未有 `parent_task_id` 字段（查 information_schema 确认）。PRD 假设了一个不存在的字段。
   - PRD §4.5：`tasks.pr_plan_id 改为 NOT NULL（现在是可选）` + 双写 `pr_plans.depends_on`
   - 实际：`pr_plans` 表锚定 `project_id`（migration 021 定义），**没有 task_id 字段**。pr_plans 是 project 级元数据，不是 task 级 1:1 映射。PRD 把这两个概念混淆了。

2. **直接跳入 M2 实施而没有先对齐 schema**
   - 本应在开工前 `psql \d tasks` 和 `\d pr_plans` 确认字段。M1 只加新表，没触到 tasks/pr_plans 的旧字段，所以问题在 M2 才暴露。

3. **M2 折中方案**：
   - parent 关系写到 `tasks.payload.parent_task_id`（jsonb 字符串），`nextRunnableTask` 用 `payload->>'parent_task_id' = $1` 过滤
   - 不写 `pr_plans`（等后续 milestone 决定是否要 schema 对齐或放弃这层 join）
   - 功能上 M2 完整可用：DAG 入库、拓扑排序、nextRunnable 查询全部工作

## 下次预防

- [ ] PRD 提到 DB 字段 / 约束时，作者应在 PRD 末尾列一条 "Schema 假设"章节，注明"以下字段已存在 / 需新增"。新增的单独写 migration，已存在的注明"经 XXXX 验证"
- [ ] 所有涉及表结构的 milestone 实施前，第一步是 `psql -c "\d <table>"` 对齐字段清单，结果写进 PR description
- [ ] PRD review 阶段（Proposer/Reviewer 对抗）要把 "schema 假设是否对" 作为独立挑战维度

## 额外积累

- **`tasks.payload` 是 Brain 里 "扩展字段"的习惯位**：已有多处用 payload 存 parent/initiative/ci_status/logical_id 等。路径偏窄时用 payload 比加 migration 快
- **`task_dependencies` 边表设计得很干净**：M1 留了 `from_task_id` + `to_task_id` + `edge_type`，用 `NOT EXISTS (... WHERE from=self AND dep.status<>'completed')` 一条 SQL 就能查 next runnable，不需要在 dashboard 和 runtime 之间重复表达依赖
- **`parseDockerOutput` + `parseTaskPlan` 组合很健壮**：Planner 输出 PRD 正文 + JSON 混排，code fence 抽取 + JSON 嵌入抽取 + 第一个完整 JSON 对象兜底，三级策略让 Planner 不用拘泥格式

## 参考

- PRD: `docs/design/harness-v2-prd.md` §3.1 §4.1-4.6 §5.1 §6.1
- M1 合并: PR #2439（migrations 236-239）
- M2 代码: `packages/brain/src/harness-dag.js` + `packages/brain/src/harness-initiative-runner.js`
