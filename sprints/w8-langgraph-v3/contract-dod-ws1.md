---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: Pre-flight 校验 + Acceptance Initiative 派发脚本

**范围**: 实现 `sprints/harness-acceptance-v3/scripts/01-preflight-and-dispatch.sh` 与配套 `sprints/harness-acceptance-v3/lib/preflight.mjs`，完成 Brain 部署一致性校验 + Acceptance task 注册派发，写出 `.acceptance-task-id`。
**大小**: M
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] 派发脚本存在且可执行
  Test: test -x sprints/harness-acceptance-v3/scripts/01-preflight-and-dispatch.sh

- [ ] [ARTIFACT] preflight 库存在且导出 `verifyDeployHead` / `assertNotEmergencyBrake` / `registerAndDispatchAcceptance`
  Test: node -e "const m=require('./sprints/harness-acceptance-v3/lib/preflight.mjs');for(const k of ['verifyDeployHead','assertNotEmergencyBrake','registerAndDispatchAcceptance']){if(typeof m[k]!=='function')process.exit(1)}"

- [ ] [ARTIFACT] 脚本头含 `set -euo pipefail`（防 silent fail）
  Test: head -5 sprints/harness-acceptance-v3/scripts/01-preflight-and-dispatch.sh | grep -q 'set -euo pipefail'

- [ ] [ARTIFACT] 脚本不在 main 分支操作（保护 main）
  Test: ! grep -E 'git (checkout|switch) main' sprints/harness-acceptance-v3/scripts/01-preflight-and-dispatch.sh

- [ ] [ARTIFACT] 脚本注册 task 时 payload 显式传入 `timeout_sec` 且 ≥ 1800
  Test: grep -E '"timeout_sec"\s*:\s*(1800|2[0-9]{3}|[3-9][0-9]{3})' sprints/harness-acceptance-v3/scripts/01-preflight-and-dispatch.sh sprints/harness-acceptance-v3/lib/preflight.mjs

- [ ] [ARTIFACT] 脚本 initiative_id 硬编码为 PRD 指定值
  Test: grep -F 'harness-acceptance-v3-2026-05-07' sprints/harness-acceptance-v3/scripts/01-preflight-and-dispatch.sh sprints/harness-acceptance-v3/lib/preflight.mjs

- [ ] [ARTIFACT] vitest hang 进程清理保护（数量上限，防误杀）
  Test: grep -E 'pgrep -f .vitest run|pkill -f .vitest run' sprints/harness-acceptance-v3/scripts/01-preflight-and-dispatch.sh

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `sprints/w8-langgraph-v3/tests/ws1/preflight-and-dispatch.test.ts`，覆盖：
- `verifyDeployHead()` 在 Brain HEAD ≠ origin/main 时抛错，相等时返回 HEAD 字符串
- `assertNotEmergencyBrake()` 当 status='emergency_brake' 抛错
- `registerAndDispatchAcceptance()` payload 必含 `timeout_sec>=1800`、`initiative_id` 等关键字段
- `registerAndDispatchAcceptance()` 成功后写出 `sprints/harness-acceptance-v3/.acceptance-task-id` 文件
