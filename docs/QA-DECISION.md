# QA Decision

Decision: MUST_ADD_RCI
Priority: P0
RepoType: Engine

## Tests

| DoD Item | Method | Location |
|----------|--------|----------|
| Database schema 初始化成功 | auto | tests/test-db-init.sh |
| Gateway HTTP 接收并验证任务 | auto | tests/test-gateway-http.sh |
| Gateway CLI 支持 add/enqueue/status | auto | tests/test-gateway-cli.sh |
| Worker 消费队列并执行任务 | auto | tests/test-worker-execution.sh |
| Worker 创建 runs 目录结构 | auto | tests/test-worker-execution.sh |
| Worker runQA intent 调用 orchestrator | auto | tests/test-worker-execution.sh |
| Worker 生成 summary.json | auto | tests/test-worker-execution.sh |
| Heartbeat 检查系统状态 | auto | tests/test-heartbeat.sh |
| Heartbeat 检测异常并入队任务 | auto | tests/test-heartbeat.sh |
| Heartbeat 触发 worker | auto | tests/test-heartbeat.sh |
| Notion sync 连接 API | auto | tests/test-notion-sync.sh |
| Notion sync 更新 System State 表 | auto | tests/test-notion-sync.sh |
| Notion sync 更新 System Runs 表 | auto | tests/test-notion-sync.sh |
| State Machine 文档完整性 | manual | 手动验证 docs/STATE_MACHINE.md |
| QA Integration 文档完整性 | manual | 手动验证 docs/QA_INTEGRATION.md |
| Directory Structure 文档完整性 | manual | 手动验证 docs/DIRECTORY_STRUCTURE.md |
| Demo 脚本一键运行成功 | auto | bash scripts/demo.sh |

## RCI

### New

- **C-DB-INIT-001**: Database 初始化
  - Priority: P0
  - Trigger: [PR, Release]
  - Test: `bash scripts/test-db-init.sh`
  - Scope: SQLite schema 创建成功，所有表和视图正确初始化

- **C-GATEWAY-HTTP-001**: Gateway HTTP 服务器
  - Priority: P0
  - Trigger: [PR, Release]
  - Test: `bash tests/test-gateway-http.sh`
  - Scope: POST /enqueue 接收任务，GET /status 返回状态，GET /health 返回健康

- **C-GATEWAY-CLI-001**: Gateway CLI 命令
  - Priority: P0
  - Trigger: [PR, Release]
  - Test: `bash tests/test-gateway-cli.sh`
  - Scope: add/enqueue/status 命令正常工作

- **C-WORKER-EXECUTION-001**: Worker 任务执行
  - Priority: P0
  - Trigger: [PR, Release]
  - Test: `bash tests/test-worker-execution.sh`
  - Scope: Worker 能 dequeue、创建 runs 目录、根据 intent 路由、生成 summary

- **C-HEARTBEAT-AUTO-001**: Heartbeat 自主监控
  - Priority: P1
  - Trigger: [PR, Release]
  - Test: `bash tests/test-heartbeat.sh`
  - Scope: 检查状态、检测异常、自动入队、触发 worker

- **C-NOTION-SYNC-001**: Notion 单向同步
  - Priority: P1
  - Trigger: [Release]
  - Test: `bash tests/test-notion-sync.sh`
  - Scope: 连接 API、更新 System State、更新 System Runs

### Update

无需更新现有 RCI

## Reason

这是 Task System 与 Quality System 的核心集成，涉及 6 个关键组件（Database, Gateway HTTP/CLI, Worker, Heartbeat, Notion Sync），每个组件都是系统正常运行的必要条件，必须纳入回归契约（P0/P1）。这些 RCI 覆盖了从任务入口到执行到状态同步的完整生命周期。
