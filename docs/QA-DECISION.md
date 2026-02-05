# QA Decision - WebSocket Status Push

Decision: MUST_ADD_RCI
Priority: P1
RepoType: Business

## Rationale

**Golden Path**: Real-time status updates are core to Command Center UX  
**Infrastructure Level**: WebSocket is critical infrastructure for task monitoring  
**Automation**: 64% automated coverage (7/11 items)

## Tests

- dod_item: "WebSocket 服务器成功启动并监听"
  method: auto
  location: brain/src/__tests__/websocket-events.test.js

- dod_item: "任务创建时发送 task:created 事件"
  method: auto
  location: brain/src/__tests__/websocket-events.test.js

- dod_item: "任务开始时发送 task:started 事件"
  method: auto
  location: brain/src/__tests__/websocket-events.test.js

- dod_item: "任务完成时发送 task:completed 事件"
  method: auto
  location: brain/src/__tests__/websocket-events.test.js

- dod_item: "任务失败时发送 task:failed 事件"
  method: auto
  location: brain/src/__tests__/websocket-events.test.js

- dod_item: "Executor 资源状态变化时发送 executor:status 事件"
  method: auto
  location: brain/src/__tests__/websocket-events.test.js

- dod_item: "多客户端同时连接能正常接收广播"
  method: auto
  location: brain/src/__tests__/websocket-events.test.js

- dod_item: "前端能成功连接 WebSocket"
  method: auto
  location: frontend/src/hooks/useTaskStatus.test.ts

- dod_item: "前端能接收并解析 WebSocket 消息"
  method: auto
  location: frontend/src/hooks/useTaskStatus.test.ts

- dod_item: "断线后自动重连成功"
  method: manual
  location: manual:重启 Brain 后验证前端重连

- dod_item: "ExecutionStatusPanel 实时显示任务状态（不再轮询）"
  method: manual
  location: manual:观察任务状态实时更新

- dod_item: "useTaskStatus Hook 返回实时任务列表"
  method: auto
  location: frontend/src/hooks/useTaskStatus.test.ts

- dod_item: "后端 WebSocket 测试通过"
  method: auto
  location: cd brain && npm test -- websocket-events.test.js

- dod_item: "前端 WebSocket 测试通过"
  method: auto
  location: cd frontend && npm test -- useTaskStatus.test

- dod_item: "RCI 回归测试通过"
  method: auto
  location: contract:WebSocket-001

## RCI

new:
  - WebSocket-001: "WebSocket 服务启动、消息推送和多客户端连接回归测试"

update: []

## Test Coverage

- **Core functionality**: 100% automated (7/7)
  - Service startup ✅
  - Event publishing ✅
  - Multi-client broadcast ✅
  - Frontend hook ✅

- **Edge cases**: Manual verification (2 items)
  - Reconnection logic: Cost-prohibitive to automate
  - Long-term stability: Requires 24h monitoring

## Reason

Golden Path feature (core UX for task monitoring) + Infrastructure component (shared by all task operations) + High automation coverage (64% overall, 100% for core features) = MUST_ADD_RCI
