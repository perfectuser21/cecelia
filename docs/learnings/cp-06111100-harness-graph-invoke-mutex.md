# Learning — 幂等去重要分层：容器回调重入 ≠ 图级并发 invoke

分支：cp-06111100-harness-graph-invoke-mutex
日期：2026-06-11

## 背景

#3335 给 harness 回调按 containerId 加了幂等，挡住了 runner curl 重试导致的【容器回调重入】。
但本次现场又出现【同一 thread 两容器并行】——checkpoint 截断重启后，startup-sync re-queue +
dispatcher dispatch 对同一 initiative 并发 invoke runHarnessInitiativeRouter，各驱动一份图。

### 根本原因

**去重/互斥要加在"会产生副作用的那一层"，而且一个系统里可能有多层入口都需要各自的互斥。**
#3335 的 claim 在【回调入口】按 containerId 去重，但【图驱动入口】runHarnessInitiativeRouter
本身没有 per-thread 互斥 —— 两条独立触发路径（startup-sync / dispatcher）可同时各跑一份图。
回调去重和图驱动互斥是两层不同的并发问题，挡了一层不等于挡了另一层。

### 下次预防

- 找"重复执行"根因时，先问：**重复发生在哪一层入口？** 回调？图 invoke？容器 spawn？每层都要
  各自的幂等/互斥键（containerId / thread_id / initiativeId）。
- 任何"同一逻辑实体同时只能跑一份"的不变量，应在该实体的【唯一驱动入口】加进程内锁
  （Map check-and-set，必须在任何 await 之前以保证原子），而不是寄希望于上游不并发触发。
- 进程内锁覆盖"同进程内的并发"；跨重启用 checkpoint 幂等 + DB claim。本 bug 的并发都在同进程内，
  进程内锁足够。

## checklist

- [ ] 排查重复执行先定位"哪一层入口重复"，每层各自幂等/互斥
- [ ] 单实体单驱动不变量在唯一驱动入口加进程内锁，锁在任何 await 之前 set
- [ ] 锁在所有出口（return/throw/超时）的 finally 释放
