# DoD：原生任务显式带租约领取并启动

- [ ] [BEHAVIOR] start:true 原子领取并进入 in_progress、创建租约及状态历史；旧 claim 默认仍保持 queued。
  Test: manual:npm exec --workspace cecelia-brain -- vitest run --config vitest.integration.config.js src/__tests__/integration/task-lease-device-pool.pg.integration.test.js
- [ ] [BEHAVIOR] 非法租约、终态、并发和租约写失败均拒绝且不残留认领或状态变化。
  Test: manual:npm exec --workspace cecelia-brain -- vitest run --config vitest.integration.config.js src/__tests__/integration/task-lease-device-pool.pg.integration.test.js
- [ ] [BEHAVIOR] claim API 传递显式 start，heartbeat 返回原生完整租约合同。
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/routes/__tests__/claim-protocol.test.js src/routes/__tests__/task-lease.test.js
