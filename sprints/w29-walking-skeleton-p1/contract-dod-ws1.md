---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: 整合 smoke 骨架 + happy path（Steps 1-3）

**范围**: 创建 `packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh`，含 shebang、`set -euo pipefail`、docker/brain 可用性顶部检测（不可用 SKIP exit 0）、psql/curl helpers、assert helpers、隔离前缀清理、Steps 1-3（投 task、POST /api/brain/tick、断言 dispatch_events 写入、SQL 模拟 reportNode 回写、断言 tasks.status='completed' + task_events 'task_completed'）。
**大小**: M（≈ 130 LOC）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] smoke 脚本文件存在且可执行
  Test: `bash -c '[ -x packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh ]'`
  期望: exit 0

- [ ] [ARTIFACT] smoke 顶部 shebang + set -euo pipefail
  Test: `bash -c 'head -2 packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh | grep -q "^#!/usr/bin/env bash" && grep -q "^set -euo pipefail" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh'`
  期望: exit 0

- [ ] [ARTIFACT] smoke 顶部含隔离前缀（test-w29-acceptance- 或 test-w29-）便于幂等清理
  Test: `grep -q "test-w29" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh`
  期望: exit 0

## BEHAVIOR 条目（内嵌可执行 manual: 命令，evaluator 直接跑）

- [ ] [BEHAVIOR] smoke 在 docker/brain 不可用时打印明确 SKIP 并 exit 0（PRD 边界要求）
  Test: manual:bash -c 'grep -E "SKIP:.*(docker|brain|不可用|not available)" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh | head -1'
  期望: 输出非空（含 SKIP 退路）

- [ ] [BEHAVIOR] Happy path 含 dispatch_events 时间窗口断言（B6 invariant — 防造假）
  Test: manual:bash -c 'grep -E "dispatch_events.*INTERVAL.*minute|created_at > NOW\(\) - INTERVAL" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh'
  期望: 输出至少 1 行，dispatch_events 查询带时间窗口

- [ ] [BEHAVIOR] Happy path 含 tasks.status='completed' 断言（B1 invariant — reportNode 回写证据）
  Test: manual:bash -c 'grep -E "status[[:space:]]*=[[:space:]]*'\''completed'\''|status.*=.*completed" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh | head -1'
  期望: 输出非空

- [ ] [BEHAVIOR] Happy path 含 task_events 'task_completed' 写入断言
  Test: manual:bash -c 'grep -E "task_events.*task_completed|event_type[[:space:]]*=[[:space:]]*'\''task_completed'\''" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh'
  期望: 输出至少 1 行

- [ ] [BEHAVIOR] Bash smoke（在 evaluator 环境无 brain/无 docker 时）应触发 SKIP exit 0；不应 exit 非 0
  Test: manual:bash -c 'bash packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh; echo "exit=$?"'
  期望: 末尾打印 `exit=0`（任何情况下，要么真跑过要么走 SKIP）
