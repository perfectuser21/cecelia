# QA Decision - KR2.2 Phase 3: 重试引擎与状态管理

Decision: MUST_ADD_RCI
Priority: P0
RepoType: Engine

Tests:
  - dod_item: "RetryEngine 能够检测可重试错误并执行指数退避重试"
    method: auto
    location: tests/services/retry/RetryEngine.test.ts

  - dod_item: "重试次数和间隔可配置（环境变量或配置文件）"
    method: auto
    location: tests/services/retry/RetryEngine.test.ts

  - dod_item: "状态管理 API 所有端点正常工作，返回正确数据格式"
    method: auto
    location: tests/routes/publish.test.ts

  - dod_item: "BullMQ 队列正确配置，任务持久化到 Redis"
    method: auto
    location: tests/queues/publish-queue.test.ts

  - dod_item: "并发控制生效：同时最多执行 N 个发布任务（N 可配置）"
    method: auto
    location: tests/queues/publish-queue.test.ts

  - dod_item: "WebSocket 能够推送状态变更事件"
    method: auto
    location: tests/routes/publish.test.ts

  - dod_item: "所有功能有对应的单元测试，覆盖率 > 80%"
    method: auto
    location: npm run test:coverage

RCI:
  new:
    - RCI-KR22-001: 发布任务重试机制验证
    - RCI-KR22-002: 状态管理 API 契约验证
    - RCI-KR22-003: BullMQ 队列持久化验证
  update: []

Reason: 这是核心引擎功能，涉及关键的发布流程可靠性，必须添加回归契约测试确保后续改动不会破坏重试和状态管理逻辑
