# Sprint PRD — Health 端点新增 evaluator_stats 字段

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：完成后预计推进至 83%
- **说明**：可观测性增强直接服务于"系统可信赖"目标，使 Harness Evaluator 运行状态可被外部监控

## 背景

Harness Evaluator 是对抗性功能验收的核心组件，但目前 `/api/brain/health` 端点不暴露任何 Evaluator 运行统计。运维和调度器无法通过 health 端点判断 Evaluator 的活跃度、成功率和最近执行情况。最近合并的 PR（active_pipelines 字段）已开始丰富 health 端点，本次延续该方向。

## 目标

在 `/api/brain/health` 响应中新增 `evaluator_stats` 字段，使 Evaluator 的执行统计可通过单一端点获取。

## User Stories

**US-001**（P0）: 作为运维人员，我希望通过 health 端点查看 Evaluator 执行统计（总次数、通过/失败数、最近执行时间），以便快速判断 Evaluator 健康状态而无需查询数据库。

**US-002**（P1）: 作为调度器（Brain Tick），我希望 health 端点包含 Evaluator 统计，以便在调度决策中参考 Evaluator 负载和成功率。

## 验收场景（Given-When-Then）

**场景 1**（关联 US-001）:
- **Given** Brain 正在运行，且已有 Evaluator 任务执行记录
- **When** 调用 `GET /api/brain/health`
- **Then** 响应 JSON 中包含 `evaluator_stats` 对象，含 `total_runs`、`passed`、`failed`、`last_run_at` 字段，且数值与实际记录一致

**场景 2**（关联 US-001）:
- **Given** Brain 正在运行，但从未执行过 Evaluator 任务
- **When** 调用 `GET /api/brain/health`
- **Then** 响应 JSON 中 `evaluator_stats` 为 `{"total_runs": 0, "passed": 0, "failed": 0, "last_run_at": null}`

**场景 3**（关联 US-002）:
- **Given** Brain 正在运行，存在多轮 Evaluator 执行记录（含通过和失败）
- **When** 调用 `GET /api/brain/health`
- **Then** `evaluator_stats.passed + evaluator_stats.failed == evaluator_stats.total_runs`，且 `last_run_at` 为最近一次执行的 ISO 时间戳

## 功能需求

- **FR-001**: `/api/brain/health` 响应新增顶级字段 `evaluator_stats`
- **FR-002**: `evaluator_stats` 包含 `total_runs`（整数）、`passed`（整数）、`failed`（整数）、`last_run_at`（ISO 时间戳或 null）
- **FR-003**: 统计数据从 Brain 数据库中 `harness_evaluate` 类型任务聚合得出
- **FR-004**: 查询不应显著增加 health 端点响应时间（目标 < 50ms 增量）

## 成功标准

- **SC-001**: `curl localhost:5221/api/brain/health` 响应包含 `evaluator_stats` 字段且结构正确
- **SC-002**: 无 Evaluator 记录时返回零值对象而非 null 或缺失字段
- **SC-003**: health 端点响应时间无显著退化（< 50ms 增量）

## 假设

- [ASSUMPTION: evaluator_stats 数据来源为 tasks 表中 task_type = 'harness_evaluate' 的记录]
- [ASSUMPTION: "passed" 定义为 status = 'completed' 且 result 中含通过标记；"failed" 为其余终态]
- [ASSUMPTION: 统计范围为全量历史记录，不限时间窗口]

## 边界情况

- 无 Evaluator 记录：返回零值对象 `{total_runs: 0, passed: 0, failed: 0, last_run_at: null}`
- 数据库连接异常：health 端点应仍返回其他字段，evaluator_stats 可降级为 null 或错误标记
- 大量历史记录：聚合查询需高效（COUNT + MAX），避免全表扫描

## 范围限定

**在范围内**:
- health 端点新增 evaluator_stats 字段
- 从现有数据库表聚合统计

**不在范围内**:
- 新增数据库表或 migration
- Evaluator 执行逻辑变更
- Dashboard UI 展示（如需要，另开任务）
- 历史数据回填

## 预期受影响文件

- `packages/brain/src/server.js`：health 端点路由定义处，需新增 evaluator_stats 查询逻辑
- `packages/brain/src/routes/` 下相关路由文件：如 health 逻辑已抽离到独立路由文件
