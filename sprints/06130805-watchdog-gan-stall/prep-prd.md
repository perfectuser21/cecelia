# Bug PrepPRD：harness liveness watchdog 漏捞 planner/GAN(A) 阶段静默卡死

## 症状
两次生产卡死（run b37f04a4、7c3a35a5）死在 planner/GAN(A) 阶段：容器跑完回调没回，
图永久 interrupt-waiting，phase 停在 `A_contract`（非 B_task_loop）。DB 里 status=in_progress、
execution_attempts=0、walking_skeleton_thread_lookup 只有 planner 行 status=spawning、近 10h 零活动、
永不重试。"全自动"在最后一步反复破功。

## 根因（已用代码路径 + DB 状态实证）
1. **覆盖面 < 故障面**：`resumeStalledHarnessDrivers`（harness-watchdog.js）SQL WHERE 含
   `ir.phase = 'B_task_loop'`，只捞 generator(B) 阶段。phase='A_contract'（GAN 阶段）被漏掉。
2. **A 阶段心跳天然陈旧**：`driver_heartbeat_at` 只在 graph stream 推进时刷（executor.writeDriverHeartbeat）；
   planner interrupt 后 stream 结束、驱动器返回，brain 内无驱动器 → 心跳结构性陈旧/NULL，
   单用心跳无法区分"合法等容器" vs "回调丢失永久卡死"。
3. **A 阶段唯一兜底是人工门**：`harness-initiative-patrol` 只建 harness_intervention 任务等人工 →
   违反 zero-human-gate，实际无人自动续。

## 关联上下文
- 相关 Journey：Cecelia Harness Pipeline
- 相关 run：b37f04a4、7c3a35a5（A 阶段卡死）；当前 R6R8（9dde3144）在 GAN 阶段跑

## 修法
`resumeStalledHarnessDrivers` 分两区段：
1. **区段 B（不变）**：phase='B_task_loop' 心跳判据 → resume_from_checkpoint（守护 #3356/#3361）。
2. **区段 A（新增）**：phase IN ('A_contract','A_planning') 用活动复合判据
   `GREATEST(driver_heartbeat_at, initiative_runs.updated_at, initiative_run_events.ts)` 静默超
   staleMinutesA（默认 20min）→ fresh-start 重排（剥离 resume_from_checkpoint → executor 重跑 planner +
   递增 execution_attempts），受 MAX_INITIATIVE_FRESH_STARTS（=3）上限约束。

## Regression Test 计划
- test 1：phase=A_contract + 活动静默 + execution_attempts<MAX → fresh-start 重排（queued + 剥离 resume）。
- test 2：A 阶段查询受 execution_attempts < MAX_INITIATIVE_FRESH_STARTS 约束；上限值作参数传入。
- test 3：已进入 B/C 阶段的 initiative 不被 A 判据误捞（NOT EXISTS 守卫）。
- test 4：staleMinutesA 默认 20、可配置。
- test 5：phase B 既有 resume 逻辑保持不变（B_task_loop + resume_from_checkpoint=true）。

## 成功标准
- [x] failing tests 先 commit（commit-1）
- [x] 修复代码让 tests 变绿（commit-2）
- [x] 现有 harness watchdog 测试套件全绿（19/19）
- [x] 全量 brain 相关回归无破坏（527 passed / 0 failed）
- [x] CI 全绿
