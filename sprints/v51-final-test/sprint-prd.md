# Sprint PRD — Health 端点新增 harness_version 字段

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：完成后预计推进至 83%
- **说明**：harness_version 字段使 health 端点能暴露当前 harness pipeline 版本，增强系统可观测性

## 背景

Cecelia Harness pipeline 已演进到 v5.1，但 `/api/brain/health` 端点未暴露当前 harness 版本信息。运维和自动化流程无法通过 health 端点确认正在运行的 harness 版本，需要新增该字段以完成系统状态的完整暴露。

## 目标

在 `/api/brain/health` 响应中新增 `harness_version` 字段，返回字符串 `"5.1"`，使调用方可通过 health 端点感知当前 harness 版本。

## User Stories

**US-001**（P0）: 作为运维/自动化系统，我希望通过 `/api/brain/health` 获取 harness 版本号，以便在巡检和调度中确认 harness pipeline 版本

## 验收场景（Given-When-Then）

**场景 1**（关联 US-001）:
- **Given** Brain 服务正常运行
- **When** 调用 `GET /api/brain/health`
- **Then** 响应 JSON 中包含 `harness_version` 字段，值为字符串 `"5.1"`

**场景 2**（关联 US-001）:
- **Given** Brain 服务正常运行
- **When** 调用 `GET /api/brain/health`
- **Then** 原有字段（status、version、uptime 等）不受影响，均正常返回

## 功能需求

- **FR-001**: `/api/brain/health` 响应新增 `harness_version` 字段，类型为字符串
- **FR-002**: `harness_version` 值为 `"5.1"`
- **FR-003**: 不影响 health 端点现有字段和行为

## 成功标准

- **SC-001**: `curl localhost:5221/api/brain/health | jq .harness_version` 返回 `"5.1"`
- **SC-002**: health 端点现有字段（status、version、uptime 等）保持不变

## 假设

- [ASSUMPTION: harness_version 值硬编码为 "5.1"，不从配置文件或环境变量读取]
- [ASSUMPTION: 不需要 DB migration，纯 API 层变更]

## 边界情况

- 无特殊边界情况，该字段为静态常量返回

## 范围限定

**在范围内**:
- `/api/brain/health` 响应新增 `harness_version` 字段

**不在范围内**:
- 不修改其他 API 端点
- 不新增 DB 字段或 migration
- 不新增配置项或环境变量
- 不修改 harness pipeline 逻辑本身

## 预期受影响文件

- `packages/brain/src/server.js`：health 端点路由定义处，新增 harness_version 字段到响应对象
