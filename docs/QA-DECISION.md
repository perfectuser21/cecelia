# QA Decision - WebSocket 状态推送

## Decision Summary
Decision: MUST_ADD_RCI
Priority: P1
RepoType: Engine

## Tests

### 功能测试
- dod_item: "前端连接 WebSocket 后能收到任务状态推送"
  method: auto
  location: tests/websocket.test.ts

- dod_item: "任务从 queued → running → completed 全程实时显示"
  method: auto
  location: tests/websocket.test.ts

- dod_item: "断网后重连能恢复接收推送"
  method: auto
  location: tests/websocket-reconnect.test.ts

- dod_item: "多客户端同时连接正常工作"
  method: auto
  location: tests/websocket-multi-client.test.ts

- dod_item: "ExecutionStatusPanel 使用 WebSocket 数据不再轮询"
  method: manual
  location: manual:检查前端代码确认移除轮询逻辑

### 技术测试
- dod_item: "WebSocket 服务器启动并监听"
  method: auto
  location: tests/websocket-server.test.ts

- dod_item: "任务创建时发送 task:created 事件"
  method: auto
  location: tests/websocket-events.test.ts

- dod_item: "任务状态变化时发送对应事件"
  method: auto
  location: tests/websocket-events.test.ts

- dod_item: "客户端自动重连机制实现"
  method: auto
  location: tests/websocket-reconnect.test.ts

## RCI
new:
  - RCI-WS-001: WebSocket 连接建立与消息推送
  - RCI-WS-002: WebSocket 重连机制
  - RCI-WS-003: 多客户端并发连接
update: []

## Reason
这是新增的 WebSocket 实时推送功能，属于核心引擎能力。需要添加回归契约确保：
1. WebSocket 服务稳定运行
2. 消息推送实时准确
3. 重连机制可靠
4. 多客户端场景正常

优先级 P1：影响用户体验（从轮询变为实时推送），但不阻塞核心功能。

## Test Plan

### 单客户端测试
1. 启动 Brain 服务
2. 前端连接 WebSocket
3. 创建一个任务
4. 验证收到 task:created, task:started, task:completed 事件
5. 验证 ExecutionStatusPanel 实时更新

### 多客户端测试
1. 打开 2 个浏览器窗口
2. 在一个窗口创建任务
3. 验证两个窗口都收到推送

### 重连测试
1. 前端连接 WebSocket
2. 重启 Brain 服务
3. 验证客户端自动重连
4. 创建任务验证推送恢复

### 并发测试
1. 同时创建 5 个任务
2. 验证所有状态变化都被推送
3. 验证消息顺序正确
