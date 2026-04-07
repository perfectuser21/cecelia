# Sprint PRD — Harness Sprint 3: 执行成本追踪

> 注：Planner 任务因 auth 失败未产出 PRD，本文件由 Proposer 从任务描述综合生成。
> 原始任务 ID: 122e677d-7cb3-4acb-a647-3548ca1a4e69

## 产品目标

当前 Brain 任务执行完成后，`result` 信息残缺——token 消耗、费用、执行时长、对话轮次均不可查询。运营方和调试者只能进入 `task_run_metrics` 表才能看到这些数据，而通过任务 API 查询时一无所获。

目标：让任何调用 `GET /api/brain/tasks/{id}` 的人，直接在响应里看到该任务的执行成本指标，不需要额外 JOIN 或查询第二张表。

## 功能清单

- [ ] Feature 1: 执行指标回写到任务 payload
  - 任务执行完成后，`payload.last_run_result` 中包含 `cost_usd`、`num_turns`、`input_tokens`、`output_tokens`、`cache_read_tokens`、`cache_creation_tokens`
- [ ] Feature 2: 任务 API 可查询指标
  - `GET /api/brain/tasks/{id}` 返回的 payload 直接包含这些指标，无需额外调用

## 验收标准（用户视角）

### Feature 1
- 用户执行一个任务后，通过 `/api/brain/tasks/{id}` 能看到 `payload.last_run_result.cost_usd` 不为 null
- 当任务失败时，已有数据的字段仍被保留，未收到数据的字段为 null（不崩溃）
- 当 result 中没有 usage 信息时，cost 字段为 null 但任务状态仍正确写入

### Feature 2
- 用户无需知道 `task_run_metrics` 表的存在
- 单次 API 调用即可获得完整执行记录

## 不在范围内
- 不修改 `task_run_metrics` 表结构（已完整）
- 不添加新的 DB 列到 tasks 表
- 不修改前端 Dashboard
- 不改变 API 路由结构
