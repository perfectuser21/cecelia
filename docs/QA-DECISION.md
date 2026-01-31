---
id: qa-decision-h7-tty-session-isolation
version: 1.1.0
created: 2026-01-31
updated: 2026-01-31
changelog:
  - 1.1.0: gate:qa 反馈修复 - P0 + MUST_ADD_RCI + auto 测试
  - 1.0.0: 初始版本
---

# QA Decision

Decision: MUST_ADD_RCI
Priority: P0
RepoType: Engine

Tests:
  - dod_item: ".dev-mode 文件包含 tty: /dev/pts/N 字段（有头模式）"
    method: auto
    location: tests/hooks/stop-hook.test.ts
  - dod_item: "Stop hook 读取 tty: 字段，当前 TTY 不匹配时 exit 0"
    method: auto
    location: tests/hooks/stop-hook.test.ts
  - dod_item: "当前 TTY 匹配时正常执行完成条件检查（exit 2）"
    method: auto
    location: tests/hooks/stop-hook.test.ts
  - dod_item: "无头模式行为不变"
    method: auto
    location: tests/hooks/stop-hook.test.ts
  - dod_item: "CLAUDE_SESSION_ID 逻辑保持不变作为 fallback"
    method: auto
    location: tests/hooks/stop-hook.test.ts
  - dod_item: "向后兼容：无 tty 字段时跳过 TTY 检查"
    method: auto
    location: tests/hooks/stop-hook.test.ts

RCI:
  new: [H7-008]
  update: []

Reason: H7 系列全部 P0，TTY 隔离是核心 Hook 会话隔离功能。Shell exit code 可通过 Vitest + execSync 自动化测试。新增 H7-008 RCI。
