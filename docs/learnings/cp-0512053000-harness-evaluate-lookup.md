# Learning — harness-evaluate graph_name lookup dispatch (P1 B9)

**Branch**: `cp-0512053000-harness-evaluate-lookup`
**Date**: 2026-05-12

## 背景

Walking Skeleton P1 终验 W30 跑 1h+ 后 ws1 sub-task 卡 await_callback。
诊断显示 evaluator container (`harness-evaluate-ws1-r1-XXX`) 已 exit=1 但 brain
log 报：`[harness-thread-lookup] unknown graph_name=harness-evaluate containerId=XXX`
→ callback 404 → graph state machine 在 PG checkpoint 永久暂停。

## 根本原因

PR #2901 加 `evaluate_contract` 节点（task sub-graph 内部 pre-merge gate）spawn
evaluator container 时**写 thread_lookup with `graph_name='harness-evaluate'`**
（zombie-task.graph.js:472-473），但 `lookupHarnessThread`（lib/harness-thread-lookup.js）
只 dispatch `walking-skeleton-1node` / `harness-task` 两种 graph，**没有 `harness-evaluate`
case** → 永远返 `null` → 404 → graph 死锁。

这是典型 walking skeleton thicken iteration 发现的 cascade hole：B1-B7 修完后第一次
真跑 W30 (74 min after B1+B8 deploy)，才暴露这个 PR #2901 引入的早期遗漏。

## 下次预防

- [ ] **加节点 + spawn 外部 task 时必 grep lookup router**：检查清单——新增 LangGraph
  节点 spawn 外部 container → 必须 grep `harness-thread-lookup.js` 看 graph_name
  是否注册。CI 加 lint：spawn 写 thread_lookup 的 graph_name 必须在 lookup router 中
  有对应 dispatch case
- [ ] **graph_name 命名一致性**：evaluate_contract 是 harness-task graph 内的节点，
  应该用同一 thread_id namespace（`harness-task:initiativeId:taskId`）不是发明
  `harness-evaluate:` prefix，避免 thread state 分裂
- [ ] **加 invariant test**：lookup-thread-lookup 单测覆盖所有 graph_name —
  从 spawn 写表的源头 `grep "graph_name="` 自动生成 lookup test cases
- [ ] **callback fail 升级到飞书告警**：404 callback 不只 console.warn，
  累计 N 次同 containerId → 主动 alert（避免静默死锁数小时）

## 关联

- Walking Skeleton P1 design + B1-B8 全合 main
- PR #2901 pre-merge gate（本洞源头）
- W30 实证 `harness-task:a69c58e4-...:ws1` PG 14 checkpoints 永卡
- callback 失配 pattern 跟 W28/W29 同根
