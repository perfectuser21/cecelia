---
id: qa-decision-websocket-status-push
version: 1.0.0
created: 2026-02-06
updated: 2026-02-06
---

# QA Decision - WebSocket 状态推送

## Decision Summary

**Decision**: MUST_ADD_RCI
**Priority**: P1
**RepoType**: Engine
**ChangeType**: feature

## Analysis

### Change Impact
- **Scope**: Backend infrastructure - WebSocket 服务
- **Risk Level**: Medium
  - 新增网络服务，影响系统稳定性
  - 实时推送机制，影响所有客户端
- **Golden Path**: Yes
  - 核心功能：任务状态实时通知
  - 影响用户体验的关键路径

### Test Strategy

#### 1. Unit Tests (Required)
自动化测试 WebSocket 核心功能：

- **Connection Management**
  - 测试客户端连接建立
  - 测试多客户端并发连接
  - 测试断线清理

- **Message Broadcasting**
  - 测试消息推送到所有客户端
  - 测试消息格式正确性
  - 测试推送不阻塞数据库操作

- **Error Handling**
  - 测试客户端连接失败
  - 测试无效消息处理
  - 测试推送失败恢复

**Location**: `brain/tests/websocket.test.ts`

#### 2. Integration Tests (Required)
测试 WebSocket 与 runs 服务集成：

- 更新 runs 状态触发推送
- 推送消息包含完整任务信息
- 多客户端都能收到更新

**Location**: `brain/tests/runs-websocket.test.ts`

#### 3. Manual Tests (Required)
验证真实环境行为：

- 使用 wscat 连接测试
- 手动更新数据库验证推送
- 验证断线重连机制

## Tests

### Unit Tests (Auto)
- dod_item: "WebSocket 服务在 Brain 端口 5221 上正常启动"
  method: auto
  location: brain/tests/websocket.test.ts::should start WebSocket server

- dod_item: "客户端可以成功连接到 ws://localhost:5221/ws"
  method: auto
  location: brain/tests/websocket.test.ts::should accept client connections

- dod_item: "服务器支持多个客户端同时连接"
  method: auto
  location: brain/tests/websocket.test.ts::should handle multiple clients

- dod_item: "断开连接后客户端状态被正确清理"
  method: auto
  location: brain/tests/websocket.test.ts::should cleanup on disconnect

- dod_item: "当 runs 表的 status 更新时，所有连接的客户端收到推送"
  method: auto
  location: brain/tests/runs-websocket.test.ts::should broadcast on status update

- dod_item: "推送消息格式符合定义的 WSMessage 接口"
  method: auto
  location: brain/tests/websocket.test.ts::should send valid message format

- dod_item: "客户端连接失败时不影响其他客户端"
  method: auto
  location: brain/tests/websocket.test.ts::should isolate client errors

- dod_item: "TypeScript 类型定义完整"
  method: auto
  location: brain/tests/websocket.test.ts::should have complete type definitions

### Manual Tests
- dod_item: "使用 wscat 手动测试连接成功"
  method: manual
  location: manual:运行 npx wscat -c ws://localhost:5221/ws 并验证连接成功

- dod_item: "手动更新数据库验证推送"
  method: manual
  location: manual:执行 UPDATE runs SET status='running' WHERE id='xxx' 后验证客户端收到消息

## RCI (Regression Contract Items)

### New RCI Items
需要新增以下回归契约：

- **RCI-WS-001: WebSocket 连接稳定性**
  - 验证：服务启动后 WebSocket 端点可访问
  - 验证：支持至少 10 个并发客户端连接
  - 验证：服务重启后客户端可重新连接

- **RCI-WS-002: 状态推送实时性**
  - 验证：runs 状态更新后 1 秒内推送到客户端
  - 验证：推送消息格式符合接口定义
  - 验证：所有连接的客户端都能收到推送

### Update RCI Items
无需更新现有 RCI（这是新功能）

## Reason

这是一个新的基础设施功能（WebSocket 服务），属于 Engine 类型仓库的核心能力：

1. **必须自动化测试**：网络服务的稳定性直接影响用户体验，需要完整的单元测试和集成测试
2. **必须添加 RCI**：WebSocket 是持久化服务，需要回归测试确保每次部署后都正常工作
3. **Golden Path**：任务状态实时通知是用户的核心体验，属于 Golden Path
4. **P1 优先级**：不是紧急修复（P0），但是重要功能（P1）

## Test Coverage Target

- **Unit Tests**: ≥ 80% 代码覆盖率
- **Integration Tests**: 覆盖所有 runs 状态变更场景
- **Manual Tests**: 覆盖真实用户使用场景

## Risk Mitigation

1. **内存泄漏风险**：测试长时间运行（连接/断开 100 次）
2. **消息风暴风险**：测试快速状态变更时的推送限流
3. **断线重连风险**：测试网络中断后的恢复机制
