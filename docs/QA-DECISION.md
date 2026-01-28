# QA Decision

Decision: NO_RCI
Priority: P1
RepoType: Business

Tests:
  - dod_item: "创建 RunDetailPanel 组件（右侧抽屉式）"
    method: manual
    location: manual:验证组件渲染和交互

  - dod_item: "显示 summary 信息"
    method: manual
    location: manual:检查 summary 数据显示正确

  - dod_item: "显示 tests 结果（饼图 + 列表）"
    method: manual
    location: manual:验证饼图和列表渲染

  - dod_item: "显示 skipped_details（可展开）"
    method: manual
    location: manual:验证可展开交互

  - dod_item: "显示 evidence 文件列表"
    method: manual
    location: manual:验证文件列表渲染

  - dod_item: "点击 Run ID 触发抽屉打开"
    method: manual
    location: manual:点击测试抽屉打开

  - dod_item: "添加 Queue 卡片（显示 pending length）"
    method: manual
    location: manual:验证卡片显示队列长度

  - dod_item: "创建 Task Queue 列表组件"
    method: manual
    location: manual:验证列表组件渲染

  - dod_item: "显示每个任务的详细信息"
    method: manual
    location: manual:验证任务信息展示

  - dod_item: "添加 Worker Status 指示器"
    method: manual
    location: manual:验证 Worker 状态显示

  - dod_item: "API: GET /api/quality/queue"
    method: auto
    location: tests/api/quality-queue.test.ts

  - dod_item: "API: GET /api/quality/worker"
    method: auto
    location: tests/api/quality-worker.test.ts

  - dod_item: "API: GET /api/quality/runs/:runId/evidence"
    method: auto
    location: tests/api/quality-evidence.test.ts

  - dod_item: "API: GET /api/quality/runs/:runId/logs/:filename"
    method: auto
    location: tests/api/quality-logs.test.ts

RCI:
  new: []
  update: []

Reason: 业务仓库的 UI 增强功能，不涉及核心路径，无需纳入回归契约。前端组件以手动验证为主，API 端点需要单元测试覆盖。
