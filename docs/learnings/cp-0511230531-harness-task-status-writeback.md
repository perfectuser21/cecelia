# Learning — reportNode 回写 tasks.status (Walking Skeleton P1 B1)

**Branch**: `cp-0511230531-harness-task-status-writeback`
**Date**: 2026-05-11

## 背景

W28 实证：harness_initiative task 6633ebbf 的 LangGraph thread 走完整条
`prep → planner → parsePrd → ganLoop → ... → run_sub_task → evaluate → report`
（13 个 PG checkpoint），但 `tasks.status` 永远卡 `in_progress`。
监控/dispatcher/consciousness-loop 都把它当"还在跑"，task_pool 被它占着。

## 根本原因

`reportNode`（`packages/brain/src/workflows/harness-initiative.graph.js:1088`）
只 UPDATE `initiative_runs.phase`，**完全不回写 `tasks.status`**。
代码注释（line 1107）写着 "executor 会标 task.status='failed'"，但这只是 ws-level
fallback —— 整个 graph happy path 走 LangGraph 节点链，**不经过 executor.js**，
没有任何环节回写 tasks 表。

发现路径：W28 task 卡 in_progress → 查 PG checkpoints 看到 reportNode 节点已写
checkpoint → 读 reportNode 源码发现只更 initiative_runs。

## 下次预防

- [ ] **新加 LangGraph 终端节点（reach END 的节点）必须回写 tasks.status**
  ：grep `addEdge\\(.*END\\)` 找出所有汇 END 节点，每个都该有对应 task 状态回写
- [ ] **task 状态回写的源头单一化**：reportNode 是唯一 single source of truth，
  executor.js 的 fallback 只在 graph 没起来时兜底，不该是平行路径
- [ ] **加 invariant 测试**：`brain-unit` 加一个 e2e test —— 跑一遍 mock graph，
  最后 assert `tasks.status` 不是 in_progress
- [ ] **定期 zombie reaper**（P1 B2）：即使将来又有节点忘记回写，watchdog 收兜底
- [ ] **dispatcher.dispatch_events 真写入**（P1 B6）：把"为什么 W28 卡着"
  这种诊断从挖代码降级到查表

## 关联

- Walking Skeleton Pathway 1 design（暂存对话）
- PR #2901 pre-merge gate（PR 之前 W28 没跑过完整 graph，hole 没暴露）
- B2 Zombie reaper（并行进行中，agent dispatching）
- B6 dispatch_events observable（并行进行中，agent dispatching）
- B7 Fleet heartbeat（并行进行中，agent dispatching）
