# QA Decision
Decision: MUST_ADD_RCI
Priority: P0
RepoType: Engine

Tests:
  - dod_item: "进程存活探测 — 每次 tick 验证 in_progress 任务进程存活"
    method: auto
    location: brain/tests/liveness-probe.test.js
  - dod_item: "启动时状态同步 — Brain 重启后修复孤儿任务"
    method: auto
    location: brain/tests/startup-sync.test.js
  - dod_item: "回调原子化 — 回调处理事务内完成"
    method: auto
    location: brain/tests/callback-atomic.test.js
  - dod_item: "心跳端点 — POST /api/brain/heartbeat 可用"
    method: auto
    location: brain/tests/heartbeat.test.js

RCI:
  new:
    - "LIVENESS-001: tick 存活探测覆盖所有 in_progress 任务"
    - "SYNC-001: Brain 重启后零孤儿残留"
    - "CALLBACK-001: 回调处理原子性"
  update: []

Reason: 核心调度引擎的状态一致性改动，直接影响任务可靠性，必须有回归契约覆盖。
