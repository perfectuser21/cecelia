# QA Decision - WebSocket 状态推送

Decision: MUST_ADD_RCI
Priority: P1
RepoType: Engine

## Tests

- dod_item: "WebSocket 服务在 Brain (5221) 端口正常启动"
  method: auto
  location: tests/websocket.test.ts

- dod_item: "客户端可以连接到 `/ws` 端点"
  method: auto
  location: tests/websocket.test.ts

- dod_item: "当 runs 表状态更新时，所有连接的客户端收到推送"
  method: auto
  location: tests/websocket.test.ts

- dod_item: "支持多客户端同时连接并接收消息"
  method: auto
  location: tests/websocket.test.ts

- dod_item: "断线重连机制工作正常"
  method: manual
  location: manual:使用 wscat 测试断线重连

- dod_item: "消息格式正确（包含 type, data, timestamp 字段）"
  method: auto
  location: tests/websocket.test.ts

- dod_item: "无内存泄漏（长时间运行稳定）"
  method: manual
  location: manual:运行 24 小时监控内存

## RCI

new:
  - WebSocket-001: "WebSocket 服务启动和消息推送回归测试"

update: []

## Reason

这是一个核心引擎功能（实时状态推送），属于 Golden Path，需要添加自动化回归测试确保长期稳定性。大部分功能可以通过单元测试自动化验证，少数场景（断线重连、内存泄漏）需要手动验证。
