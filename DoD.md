- [x] Activity 会话组支持同组共享、异组隔离、跨 run 隔离与缺省兼容，恢复不重复启动已提交动作。
  Test: manual:npm exec -w packages/brain -- vitest run src/orchestrator/__tests__/commander-session-groups.test.js
- [x] 非法配置、损坏线程身份及 CLI 换号即使退出零也拒绝成功；认证与 Code 路径保持既有边界。
  Test: manual:npm exec -w packages/brain -- vitest run src/orchestrator/__tests__/commander-session-groups.test.js src/orchestrator/__tests__/commander-api-auth.test.js src/orchestrator/__tests__/commander-code-adapter.test.js
- [x] 会话分组参与运行定义冻结，原恢复、心跳、清理和软链接入口回归通过。
  Test: manual:npm exec -w packages/brain -- vitest run src/orchestrator/__tests__/commander-foundation-guards.test.js src/orchestrator/__tests__/commander-reconnect-races.test.js src/orchestrator/__tests__/commander-supervise.test.js
