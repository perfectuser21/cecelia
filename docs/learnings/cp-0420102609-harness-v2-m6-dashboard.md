# Learning — Harness v2 M6 Dashboard + 飞书 + Report

**分支**: cp-0420102609-harness-v2-m6-dashboard
**日期**: 2026-04-20
**相关 PR**: M6（Initiative Dashboard + 新建入口 + 飞书通知 + Report 模板）

## 做了什么

1. 后端 `packages/brain/src/routes/initiatives.js` — `GET /:id/dag` 一次聚合
   initiative_contracts / initiative_runs / tasks / task_dependencies，供前端画图
2. 前端 `apps/dashboard/src/pages/harness/InitiativeDetail.tsx` — 三阶段进度条 +
   Mermaid DAG + Task 卡片 + Cost 面板 + E2E Verdict
3. Dashboard 列表改下拉：单 PR（v1）/ Initiative（v2，描述 ≥100 字）
4. `notifier.js` 加 4 个 Harness v2 hook：合同 APPROVED / Task merged /
   阶段 C PASS|FAIL / 预算或超时预警
5. `harness-report` SKILL.md 追加 Initiative 级 Report 章节（4 账号位置 hard-link
   同步）

## 踩的坑 / 决策

### 根本原因

- **Task 表没有显式 `parent_task_id` 列**：harness_task 父子关系存在
  `payload->>'parent_task_id'`（harness-dag.js:299 `nextRunnableTask` 用同样
  的 JSONB 过滤）。初版路由查询用 `t.parent_task_id = $1` 会查不到任何行。
- **pr_plans 表没有 `pr_url` / `branch_name` 列**：PR URL 其实在 tasks
  表的 `pr_url` 列（migration 130 加的 task_execution_metrics）。联 join
  pr_plans 只能拿 `depends_on` uuid[]。
- **hook 调用点不改 runner 核心**：用户明确约束"不改 initiative-runner.js
  核心逻辑"。因此 M6 只导出 notifier 函数，调用点由 M3/M5（Reviewer APPROVED /
  Final E2E / Budget Checker）各自接入。

### 下次预防

- [ ] 改任何涉及 `tasks` 父子关系的查询，先确认用 `payload->>'parent_task_id'`
      而非 `parent_task_id` 列
- [ ] pr_plans 只存规划态字段；PR URL / 分支名 / merged 状态都在 tasks 表
- [ ] Harness v2 通知 hook 接入点由 phase 切换触发：contract.status=approved
      → approved；tasks.status=completed + pr_merged_at IS NOT NULL → task
      merged；e2e_final runner verdict → final e2e；tick 层 budget/timeout
      检查 → warning

## 约束

- PR size < 1500 行（硬约束）
- 只改外层读/写 API + 前端视图 + notifier hook exports
- 不碰 harness-graph.js / harness-initiative-runner.js / migrations

## 验证

- `packages/brain/src/__tests__/integration/initiatives-dag-endpoint.integration.test.js`
- `packages/brain/src/__tests__/notifier-harness-v2.test.js`
- `apps/dashboard/src/pages/harness/__tests__/InitiativeDetail.test.tsx`
