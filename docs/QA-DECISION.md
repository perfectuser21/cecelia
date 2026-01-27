# QA Decision

Decision: MUST_ADD_RCI
Priority: P0
RepoType: Engine

Tests:
  - dod_item: "Gateway 可接收来自多个源的任务（标准化格式）"
    method: auto
    location: tests/gateway.test.ts

  - dod_item: "Queue 可存储和读取任务（支持优先级）"
    method: auto
    location: tests/queue.test.ts

  - dod_item: "Worker 可消费队列并调用 CloudCode 无头/Orchestrator"
    method: auto
    location: tests/worker.test.ts

  - dod_item: "State 可追踪系统状态（最后运行、队列长度）"
    method: auto
    location: tests/state.test.ts

  - dod_item: "Heartbeat 可定时检查并自动入队任务"
    method: auto
    location: tests/heartbeat.test.ts

  - dod_item: "端到端测试：从任意输入源 → Gateway → Queue → Worker → Evidence"
    method: auto
    location: tests/e2e-gateway.test.ts

  - dod_item: "演示：手动触发 + n8n 触发 + Heartbeat 自动触发，三种方式都能正常工作"
    method: manual
    location: manual:验证三种触发方式都能正常入队并执行

RCI:
  new:
    - C-GATEWAY-001  # Gateway 接收任务并入队
    - C-WORKER-001   # Worker 消费队列并执行
    - C-HEARTBEAT-001 # Heartbeat 自动监控并入队
  update: []

Reason: Gateway 系统是 Cecelia 自驱动的核心基础设施（丘脑），必须纳入回归契约保证其稳定性。Gateway/Worker/Heartbeat 三个核心组件的正常运行是系统自动化运作的前提条件，属于 Must-never-break 级别。
