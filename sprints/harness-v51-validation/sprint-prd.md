# Sprint PRD — Health 端点新增 pipeline_version 字段

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：完成后预计推进至 83%
- **说明**：pipeline_version 是 Harness v5.1 验证流程的前置条件，属于系统可信赖性基础设施

## 背景

Harness pipeline 从 v4.x 升级到 v5.1，引入了新的验证流程：Generator PR 不再自动 merge，而是由 Evaluator 在临时 Brain（端口 5222）上执行功能验收测试，PASS 后才触发 merge → deploy → smoke test → report → cleanup。为了让 Evaluator 能够确认目标 Brain 实例运行的是哪个 pipeline 版本，需要在 `/api/brain/health` 端点中暴露 `pipeline_version` 字段。

## 目标

在 Brain 的 `/api/brain/health` 返回值中新增 `pipeline_version` 字段（字符串 `"5.1"`），供 Evaluator 在验证阶段确认 pipeline 版本。

## User Stories

**US-001**（P0）: 作为 Evaluator Agent，我希望通过 `/api/brain/health` 获取 `pipeline_version` 字段，以便确认目标 Brain 实例运行的 pipeline 版本是否符合预期。

**US-002**（P1）: 作为系统运维者，我希望 health 端点包含 pipeline 版本信息，以便在巡检时快速确认当前运行的 pipeline 版本。

## 验收场景（Given-When-Then）

**场景 1**（关联 US-001）:
- **Given** Brain 正常运行在端口 5221
- **When** 调用 `GET /api/brain/health`
- **Then** 返回 JSON 中包含 `pipeline_version` 字段，值为 `"5.1"`

**场景 2**（关联 US-001）:
- **Given** Evaluator 启动临时 Brain 在端口 5222
- **When** 调用 `GET localhost:5222/api/brain/health`
- **Then** 返回 JSON 中同样包含 `pipeline_version: "5.1"`

**场景 3**（关联 US-002）:
- **Given** Brain 正常运行
- **When** 调用 `GET /api/brain/health` 并检查所有字段
- **Then** 原有字段（status, uptime, active_pipelines, evaluator_stats, tick_stats, organs, timestamp）保持不变，`pipeline_version` 为新增字段

## 功能需求

- **FR-001**: `/api/brain/health` 响应 JSON 新增顶层字段 `pipeline_version`，类型为字符串，值为 `"5.1"`
- **FR-002**: 该字段为硬编码常量，不依赖数据库或外部配置
- **FR-003**: 不改变 health 端点现有字段的结构和语义

## 成功标准

- **SC-001**: `curl localhost:5221/api/brain/health | jq .pipeline_version` 输出 `"5.1"`
- **SC-002**: health 端点原有字段（status, uptime, evaluator_stats 等）行为不变

## 假设

- [ASSUMPTION: pipeline_version 为硬编码常量 "5.1"，未来版本升级时手动更新此值]
- [ASSUMPTION: Evaluator 临时 Brain 实例使用相同代码，因此自动继承 pipeline_version 字段]

## 边界情况

- 无数据库依赖，不存在 DB 连接失败影响该字段的情况
- 字段为常量，不存在运行时计算错误的可能

## 范围限定

**在范围内**:
- health 端点新增 `pipeline_version` 字段
- 确保现有字段不受影响

**不在范围内**:
- 修改 Evaluator 验证逻辑（Evaluator 侧读取 pipeline_version 的逻辑不在本 PR 范围）
- 动态读取 pipeline 版本（从配置文件或环境变量）
- 修改其他 API 端点

## 预期受影响文件

- `packages/brain/src/server.js`：health 端点定义位置，需在返回对象中新增字段
