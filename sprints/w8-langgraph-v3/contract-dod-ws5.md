---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 5: 故障注入 C — Deadline 逾期 → watchdog → fresh thread

**范围**: 实现 `sprints/harness-acceptance-v3/scripts/05-inject-deadline-overdue.sh` + `sprints/harness-acceptance-v3/lib/inject-deadline-overdue.mjs`，UPDATE initiative_runs.deadline_at 为过去时刻触发 watchdog，重派后验证 attempt+1 fresh thread。
**大小**: M
**依赖**: Workstream 4

## ARTIFACT 条目

- [ ] [ARTIFACT] 注入脚本存在且可执行
  Test: test -x sprints/harness-acceptance-v3/scripts/05-inject-deadline-overdue.sh

- [ ] [ARTIFACT] 注入库存在且导出 `nudgeDeadline` / `restoreDeadline` / `pollWatchdog` / `redispatchAndAssertFreshThread`
  Test: node -e "const m=require('./sprints/harness-acceptance-v3/lib/inject-deadline-overdue.mjs');for(const k of ['nudgeDeadline','restoreDeadline','pollWatchdog','redispatchAndAssertFreshThread']){if(typeof m[k]!=='function')process.exit(1)}"

- [ ] [ARTIFACT] 脚本头含 `set -euo pipefail` + `trap` 还原 deadline_at（异常路径也走 finally）
  Test: head -10 sprints/harness-acceptance-v3/scripts/05-inject-deadline-overdue.sh | grep -E 'set -euo pipefail' && grep -E 'trap.*restoreDeadline|trap.*restore|trap.*EXIT' sprints/harness-acceptance-v3/scripts/05-inject-deadline-overdue.sh

- [ ] [ARTIFACT] UPDATE 语句强制带 `WHERE` 且含 `attempt=` 限定（防全表 UPDATE）
  Test: grep -E "UPDATE\s+initiative_runs\s+SET\s+deadline_at[^;]*WHERE[^;]*attempt\s*=" sprints/harness-acceptance-v3/lib/inject-deadline-overdue.mjs

- [ ] [ARTIFACT] UPDATE 同时限定 `initiative_id=` 单值（不允许 LIKE/IN 全集）
  Test: grep -E "WHERE[^;]*initiative_id\s*=\s*'[a-z0-9-]+'|WHERE[^;]*initiative_id\s*=\s*\\\$" sprints/harness-acceptance-v3/lib/inject-deadline-overdue.mjs

- [ ] [ARTIFACT] watchdog 反应轮询超时上限 ≤ 360s（PRD 要求 5 分钟内扫到）
  Test: grep -E 'watchdog.*timeout.*(300|360)|WATCHDOG_TIMEOUT_SEC=(300|360)' sprints/harness-acceptance-v3/lib/inject-deadline-overdue.mjs sprints/harness-acceptance-v3/scripts/05-inject-deadline-overdue.sh

## BEHAVIOR 索引（实际测试在 tests/ws5/）

见 `sprints/w8-langgraph-v3/tests/ws5/inject-deadline-overdue.test.ts`，覆盖：
- `nudgeDeadline({initiativeId, attempt})` 拒绝 attempt 缺失（throw）；拒绝 initiativeId 通配符如 `%`（throw）
- `restoreDeadline()` 即使 SQL 抛错也不向上传播（吞掉，避免 finally 失败）
- `pollWatchdog({initiativeId, attempt, deadline})` 命中 phase=failed/failure_reason=watchdog_overdue 即返回 ok=true
- `redispatchAndAssertFreshThread({initiativeId, prevAttempt})` 校验新 attempt = prev+1 且 thread_id 不同；相同时 throw
