---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: HOL skip + zombie reaper 段（Steps 4-5）

**范围**: 在 WS1 的 smoke 文件上追加 Step 4（HOL skip：投 task_A + task_B + task_C，task_A 故意构造为不可派发；POST /tick；断言 task_A 维持 pending、task_B 或 task_C 进入 dispatch_events）+ Step 5（zombie reaper：构造 30 分钟 idle 的 in_progress task；node -e 调 `reapZombies({ idleMinutes: 0 })`；断言 tasks.status='failed' + error_message 含子串 `[reaper] zombie`）。
**大小**: M（≈ 70 LOC 追加）
**依赖**: WS1（smoke 文件必须先存在）

## ARTIFACT 条目

- [ ] [ARTIFACT] smoke 文件含 HOL skip 段（test-w29-hol-A/B/C 任务投递）
  Test: `bash -c 'grep -q "test-w29-hol-A" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh && grep -q "test-w29-hol-B" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh && grep -q "test-w29-hol-C" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh'`
  期望: exit 0

- [ ] [ARTIFACT] smoke 文件含 zombie 段（test-w29-zombie task + reapZombies 调用）
  Test: `bash -c 'grep -q "test-w29-zombie" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh && grep -q "reapZombies" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh'`
  期望: exit 0

## BEHAVIOR 条目

- [ ] [BEHAVIOR] HOL skip 段：task_A 构造为不可派发（force_location=nonexistent-* 或等价 worker 不可用标识）
  Test: manual:bash -c 'grep -E "force_location.*nonexistent|nonexistent-xyz|no_executor|unreachable" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh'
  期望: 输出至少 1 行

- [ ] [BEHAVIOR] HOL skip 段：断言 task_A 仍 pending（HOL 没让它阻塞队列）
  Test: manual:bash -c 'grep -E "test-w29-hol-A.*pending|pending.*test-w29-hol-A|A_STATUS.*pending" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh'
  期望: 输出至少 1 行（task_A 状态断言为 pending）

- [ ] [BEHAVIOR] HOL skip 段：断言 task_B 或 task_C 至少 1 个进入 dispatch_events（B5 — 队首不阻塞）
  Test: manual:bash -c 'grep -E "test-w29-hol-B.*test-w29-hol-C|task_id IN.*test-w29-hol-B" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh'
  期望: 输出至少 1 行

- [ ] [BEHAVIOR] zombie reaper 段：调用 reapZombies({ idleMinutes: 0 }) 强制扫描所有 in_progress
  Test: manual:bash -c 'grep -E "reapZombies.*idleMinutes.*0|ZOMBIE_REAPER_IDLE_MIN=0" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh'
  期望: 输出至少 1 行

- [ ] [BEHAVIOR] zombie reaper 段：断言 error_message 含字面值 `[reaper] zombie`（B2 — reaper 标记证据）
  Test: manual:bash -c 'grep -E "error_message.*\[reaper\] zombie|\[reaper\] zombie" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh'
  期望: 输出至少 1 行

- [ ] [BEHAVIOR] zombie reaper 段：断言 tasks.status 从 in_progress 变为 'failed'（B2 invariant）
  Test: manual:bash -c 'grep -E "status[[:space:]]*=[[:space:]]*'\''failed'\''|RESULT.*=.*failed" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh'
  期望: 输出至少 1 行
