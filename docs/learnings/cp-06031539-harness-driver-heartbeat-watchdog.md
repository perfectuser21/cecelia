# Learning: OPEN-2 — harness 驱动器死后 park 等重启（B_task_loop 卡死根因）

> 分支：cp-0603153903-harness-driver-heartbeat-watchdog
> 日期：2026-06-03

## 现象

48 条 harness_initiative run 卡在 `phase=B_task_loop`，0 容器、对其零活动、phase 永久不前进。
尸检样本 5cce6d29：task 实际**已端到端跑完**（PR #3270 已合并、final_e2e=PASS），
但 parent graph checkpoint 停在 `next=[run_sub_task]`，直到一次 brain 重新部署（startup-sync
重排）才把 completed 状态写回。所以"卡死"不是没干活，是**结果没人收尾**。

## 根本原因

harness_initiative 的 parent LangGraph 在 `planner` interrupt 之后**没有任何持久化的周期性驱动器**：

1. executor 用 `compiled.stream()` 驱动，stream 在 planner `interrupt()` 处结束 → 任务留 in_progress。
2. planner 容器回调后，`harness-callback.js` 用**一次性 in-memory `invoke(Command(resume))`** 把 graph
   从 planner 一口气同步驱动到 END——中间要穿过 `ganLoop`（数分钟）和 `run_sub_task`（最长 90min 阻塞 poll）。
   这一长跑全程跑在一个 HTTP 回调 handler 里，**非持久化**。
3. 一旦这个唯一的内存驱动器在到 END 前丢失（brain 重启/部署、handler 抛异常/被 abort），任务就 park
   在最后 checkpoint。dispatcher 只 claim `status='queued'`，从不 resume 停在 checkpoint 的 in_progress
   任务；唯一的 re-driver `syncOrphanTasksOnStartup` **只在 brain 启动时跑一次** → 任务死等下次重启。

## 修法

驱动器存活信号（心跳）+ tick 级看门狗周期重排：

- `tasks.driver_heartbeat_at`（migration 292）：活驱动每 ~30s 刷新（executor stream loop + `run_sub_task`
  的 `_waitForSubGraphCompletion` poll）。心跳新鲜 = 有驱动在 pump；陈旧 = 驱动器已死。
- `resumeStalledHarnessDrivers`（tick 级）：只重排「心跳陈旧(>3min) 且 `phase=B_task_loop`」的 in_progress
  harness 任务（→ queued + resume_from_checkpoint + 清 claim 三件套）。
- dispatcher `shouldApplyHarnessCap`：resume 任务豁免并发 cap，防自愈被 cap 锁死。

### 关键安全设计（为什么只扫 B_task_loop）

`A_planning` 阶段 graph 停在 planner interrupt 等容器回调，是**合法的无驱动器等待**——心跳也会陈旧。
若按心跳陈旧无脑重排，会在 planner 慢跑时反复 thrash。因此看门狗**只扫 B_task_loop**（run_sub_task
阻塞区，真正的死驱动 park 区），天然排除 planner-interrupt-wait 和活 GAN（A 相位）。
GAN 相位的死驱动恢复留作后续（A_contract 历史仅 1 例，非主力症状）。

## 下次预防

- LangGraph parent graph 的**长阻塞节点不应由 HTTP 回调 handler 的 invoke 驱动**——回调应只清 interrupt
  并把驱动交还给持久化的 executor/dispatcher 循环。本 PR 是兜底（看门狗自愈），根治需把驱动层做成持久化。
- 任何"in_progress 但无 OS 子进程"的 LangGraph 任务，必须有 boot 之外的周期性 resume 路径，不能只靠重启自愈。
- 心跳类信号必须 non-fatal，且看门狗的重排谓词必须排除"合法的无驱动器等待"状态（interrupt-wait）。

## 验证 checklist

- [x] 先写 failing test（commit-1 Red：resumeStalledHarnessDrivers / writeDriverHeartbeat / shouldApplyHarnessCap）
- [x] 实现让 test 变绿（commit-2 Green），13/13 通过
- [x] 既有回归测试不破（harness-watchdog / executor-startup-sync / dispatcher-harness-concurrency-cap 全绿）
- [x] DevGate facts-check 通过（schema_version 292 三处同步）
- [ ] CI 全绿后合并 + 部署 live
