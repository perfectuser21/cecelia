# Learning — Reaper threshold + harness_* exempt (P1 B8 cascade fix)

**Branch**: `cp-0512040000-zombie-reaper-tune`
**Date**: 2026-05-12

## 背景

Walking Skeleton P1 终验 W29（harness_initiative）派出后跑 GAN 多 round。
spawn 时序：planner 7min → propose R1 6min → review R1 2min → propose R2 → review R2 → propose R3...
持续 31 min 在 spawn，但 `tasks.updated_at` 41min 不变（41min ago = restart 时间）→ B2 reaper
30 min idle 阈值触发 → 误把 active task 标 failed。

## 根本原因

`tasks.updated_at` **只在 status 显式 UPDATE 时变**（如 dispatcher pick / reportNode 写回）。
LangGraph 节点内部 transition、容器 spawn / await_callback / PG checkpoint 写入**都不 touch tasks 表**。
所以 reaper 看 `updated_at` 判 "idle" 是错的指标 —— 它把"task 在 graph 内忙跑"误判为"卡死"。

W29 spawn 时序证据：13:41 created → 13:42 in_progress → 后续每 2-7min 一个 spawn → 但 updated_at 一直停在 13:42 → 30min 后被 reaper 杀。

## 下次预防

- [ ] **新 reaper 看更细的活跃度信号**（B9 候选）：不仅 `updated_at`，还查 PG `checkpoints` 表最新 checkpoint_id 时间 / dispatch_events 最新 task_id event。任何信号在窗口内活跃 → 不当 zombie。
- [ ] **`tasks.updated_at` 改成 graph 内部活动也 touch**（更对的修法，但侵入大）：spawn/await_callback/parse_callback 等节点 UPDATE 一行。
- [ ] **加 zombie reaper 决策日志**：每次 reap 前后写 dispatch_events，让"为什么标失败"可追溯（B6 已立框架）。
- [ ] **harness 任务测试时 reaper threshold 配置化**：CI / 终验跑 W* 时设 `ZOMBIE_REAPER_IDLE_MIN=120` 避开误杀。
- [ ] **DoD 加约束**：新 task_type 引入时（如新 graph）必须 grep reaper 默认豁免清单，决定是否加进去。

## 关联

- Walking Skeleton P1 design（B1-B7 已合 + dep-audit relax）
- B2 PR #2905 zombie reaper 初版
- W29 实证 thread `harness-initiative:38809ac3-e6c7-454c-9f56-6bd414677b71:1/2` PG checkpoints
- Cascade hole 暴露顺序：P1 B1-B7 全合 → W29 派 → reaper 杀 → 发现新洞
