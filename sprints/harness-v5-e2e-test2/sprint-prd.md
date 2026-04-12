# Sprint PRD — Brain Health 添加 active_pipelines 字段

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：完成后预计推进至 83%（Harness v5.0 全链路验证里程碑）
- **说明**：本任务是 Harness v5.0 E2E 验证的第 2 个测试用例，验证 Planner→Proposer→Reviewer→Generator→Evaluator 全链路能否端到端运行

## 背景

Harness v5.0 引入了多阶段 pipeline 架构（Planner→GAN→Generator→Evaluator）。为了在运行时可观测当前有多少条 pipeline 正在执行，需要在 Brain 的 health 端点中暴露这一信息。这是一个刻意设计的简单功能，目的是用最小改动验证 Harness v5.0 全链路是否能正确完成从 PRD 到代码合并的完整流程。

## 目标

在 `/api/brain/health` 返回值中新增 `active_pipelines` 整数字段，实时反映当前正在执行的 harness pipeline 数量。

## User Stories

**US-001**（P0）: 作为运维人员，我希望通过 health 端点看到当前活跃的 harness pipeline 数量，以便快速判断系统的 pipeline 负载状态

**US-002**（P1）: 作为 Harness 调度器，我希望 health 端点提供 active_pipelines 数据，以便后续可基于该值做并发控制决策

## 验收场景（Given-When-Then）

**场景 1**（关联 US-001）— 有活跃 pipeline 时返回正确计数:
- **Given** tasks 表中有 2 条 task_type='harness_planner' 且 status='in_progress' 的记录
- **When** 调用 `GET /api/brain/health`
- **Then** 返回 JSON 中包含 `"active_pipelines": 2`

**场景 2**（关联 US-001）— 无活跃 pipeline 时返回 0:
- **Given** tasks 表中没有 task_type='harness_planner' 且 status='in_progress' 的记录
- **When** 调用 `GET /api/brain/health`
- **Then** 返回 JSON 中包含 `"active_pipelines": 0`

**场景 3**（关联 US-001）— 其他 task_type 不计入:
- **Given** tasks 表中有 task_type='content-copywriting' 且 status='in_progress' 的记录，但没有 harness_planner 类型的
- **When** 调用 `GET /api/brain/health`
- **Then** 返回 `"active_pipelines": 0`

## 功能需求

- **FR-001**: `/api/brain/health` 返回值新增 `active_pipelines` 字段，类型为整数（integer）
- **FR-002**: `active_pipelines` 的值 = tasks 表中 `task_type='harness_planner'` 且 `status='in_progress'` 的记录数
- **FR-003**: 该字段必须在每次请求时实时查询，不使用缓存

## 成功标准

- **SC-001**: `curl localhost:5221/api/brain/health` 返回 JSON 包含 `active_pipelines` 字段且值为非负整数
- **SC-002**: 该字段值与 `SELECT count(*) FROM tasks WHERE task_type='harness_planner' AND status='in_progress'` 结果一致
- **SC-003**: health 端点响应时间不因新增字段而显著增加（<50ms 增量）

## 假设

- [ASSUMPTION: `active_pipelines` 仅统计 task_type='harness_planner'，不包含 harness_generator、harness_evaluator 等其他 harness 相关类型]
- [ASSUMPTION: 使用现有 tasks 表的 task_type 和 status 字段即可完成查询，无需新增数据库列或索引]

## 边界情况

- tasks 表中无任何 harness_planner 记录时，返回 0（不返回 null 或省略字段）
- 数据库连接异常时，health 端点现有的错误处理机制应继续生效，active_pipelines 查询失败不应导致整个 health 端点崩溃

## 范围限定

**在范围内**:
- `/api/brain/health` 端点新增 `active_pipelines` 字段
- 对应的 SQL 查询逻辑

**不在范围内**:
- 基于 active_pipelines 的并发控制逻辑（后续任务）
- 其他 harness task_type 的计数（如 harness_generator、harness_evaluator）
- Dashboard UI 展示
- 历史 pipeline 统计或趋势分析

## 预期受影响文件

- `packages/brain/src/server.js`：health 端点路由定义处，需在返回值中新增字段
- `packages/brain/src/selfcheck.js`：如果 health 逻辑封装在此，可能需要修改
