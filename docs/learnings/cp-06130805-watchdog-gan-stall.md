# Learning — harness liveness watchdog 漏捞 planner/GAN(A) 阶段静默卡死

- 分支: cp-06130805-watchdog-gan-stall
- 日期: 2026-06-13
- 范围: packages/brain/src/harness-watchdog.js（resumeStalledHarnessDrivers）

## 现象

两次生产卡死（run b37f04a4、7c3a35a5）死在 planner/GAN(A) 阶段：容器跑完回调没回，
图永久 interrupt-waiting，phase 停在 `A_contract`（非 B_task_loop）。表现为 DB 里
status=in_progress、execution_attempts=0、walking_skeleton_thread_lookup 只有 planner 行
status=spawning、近 10h 零活动、永不重试。"全自动"在最后一步反复破功。

## 根本原因

1. **覆盖面 < 故障面**：`resumeStalledHarnessDrivers` 的 SQL WHERE 含 `ir.phase = 'B_task_loop'`，
   只重排 generator(B) 阶段心跳陈旧的任务。planner/GAN(A) 阶段卡死的 run（phase='A_contract'）
   被这条过滤直接漏掉 → 永远没人捞。
2. **A 阶段心跳天然陈旧，不能套用 B 的心跳判据**：`tasks.driver_heartbeat_at` 只在
   `runHarnessInitiativeRouter` 的 graph stream 循环里刷（executor.js `writeDriverHeartbeat`，
   每个 node 推进刷一次）。planner `interrupt()` 后 stream 结束、驱动器返回，续跑靠
   planner-callback 的一次性 in-memory invoke。等容器回调这段窗口 **brain 内本就无驱动器** →
   心跳结构性陈旧/NULL。所以单用心跳无法区分"合法等容器" vs "回调丢失永久卡死"——这正是
   旧版故意"排除 A_planning"的由来，但代价是 A 阶段卡死永远没人管。
3. **A 阶段唯一兜底是人工门**：`harness-initiative-patrol` 检测到 A/GAN 卡住只
   **创建 harness_intervention 任务等人工/agent 干预**，不自动 fresh-start → 违反 zero-human-gate，
   实际无人自动续 → 10h 死等。

## 修复

`resumeStalledHarnessDrivers` 分两区段：
- **区段 B（不变）**：phase='B_task_loop' 用心跳判据 → resume_from_checkpoint 续跑（守护 #3356/#3361）。
- **区段 A（新增）**：phase IN ('A_contract','A_planning') 用**活动复合判据**——
  `GREATEST(driver_heartbeat_at, initiative_runs.updated_at, initiative_run_events.ts)` 全部静默超
  staleMinutesA（默认 20min）。活 GAN/planner 容器每轮回调写 run_events（注意该表是 `ts` BIGINT
  epoch 秒，无 created_at），心跳新鲜=活，别动。命中 → **fresh-start 重排**：剥离
  resume_from_checkpoint，让 executor 走 `existing && !resumeRequested` 分支重跑 planner（重新 spawn
  容器）并**递增 execution_attempts**，受 `MAX_INITIATIVE_FRESH_STARTS`（=3）上限约束
  （查询带 `execution_attempts < 上限`，超限不再重排，由 executor terminal-fail 收尾）。
  A 阶段无活驱动 → fresh-start 无双驱动风险。

watchdog 每 `HARNESS_WATCHDOG_INTERVAL_MS`（默认 5min）跑一次（tick-runner.js），
A 阶段卡死可在 ~20-25min 内被自动捞起重试。

## 教训（核心）

**liveness 巡检的覆盖面必须 = 故障面。只捞 B 阶段 = A 阶段卡死永远没人管，"全自动"就破在这。**
新增一道恢复机制时，先列全故障面（所有阶段 / 所有状态），逐一确认每种卡死都有人捞；
判活信号在不同阶段的语义可能不同（B 阶段心跳=活；A 阶段心跳天然缺失，要靠 run_events/活动综合判），
不能一套判据套全程。

### 根本原因

watchdog 捞取条件（phase=B_task_loop）窄于故障面（A/B 阶段都会卡死），且把"B 阶段判活信号
（driver_heartbeat）"错当成全阶段通用信号——A 阶段该信号结构性缺失。

### 下次预防

- [ ] 新增/修改 liveness 巡检时，先穷举故障面（所有 phase × 所有卡死形态），确认逐一有兜底
- [ ] 跨阶段复用"判活信号"前，确认该信号在每个阶段的写入语义都成立（心跳只在 stream pump 时刷）
- [ ] 自愈路径必须递增 execution_attempts 且受 MAX_INITIATIVE_FRESH_STARTS 上限，杜绝坏任务无限重试
- [ ] A 阶段恢复用 fresh-start（重跑 planner）而非 resume（resume 会在丢失的 interrupt 处再次挂起）
- [ ] 兜底机制不能止于"建 intervention 任务等人工"——zero-human-gate 要求能自动续
