# Learning — evaluate_contract thread_id 复用 harness-task namespace (P1 B10)

**Branch**: `cp-0512072000-evaluate-thread-id`
**Date**: 2026-05-12

## 背景

Walking Skeleton P1 终验 W31 跑到 evaluate_contract callback PASS：
- evaluator container exit=0 ✓
- callback POST 收到 → lookupHarnessThread 返 `{compiledGraph, threadId='harness-evaluate:...'}` ✓
- compiledGraph.invoke(Command{resume:...}, {thread_id}) 调用成功 ✓

**但 graph 没真推进** — evaluate thread 2 个 checkpoint，task thread 13 个 checkpoint 不增。

## 根本原因

PR #2901 evaluate_contract 节点本身在 **harness-task graph 内**运行 (`buildHarnessTaskGraph().addNode('evaluate_contract', ...)`)。`interrupt()` 让 graph 暂停 → state 写到 PG checkpoint 在 thread `harness-task:${initiativeId}:${taskId}`。

但 spawn evaluator container 时写 thread_lookup 用**新发明的 thread_id** `harness-evaluate:${initiativeId}:${taskId}`。callback resume 时 `lookupHarnessThread` 返回这个 thread_id → `graph.invoke(Command{resume:...}, {thread_id:'harness-evaluate:...'})` 实际打到一个 PG checkpoint 里**没真 interrupt 等待**的 empty thread → 创建新 thread state 但没 resume 真正 interrupt 的 task thread。

真正 interrupt 等待的 `harness-task:...` thread 永久卡 await_callback。

## 下次预防

- [ ] **interrupt() + spawn 外部 task 时 thread_id namespace 必须跟父 graph 一致**：
  evaluate_contract 是 task graph 子节点 → spawn 写 lookup 用 task graph 的 thread_id，不发明新 prefix。invariant：lookup_table.thread_id 必须存在于 PG checkpoint 表
- [ ] **加测试 covers callback round-trip**：spawn → write lookup → callback retrigger → graph 真推进（不只是 ok:true 返回）
- [ ] **invariant 监控**：callback 处理后 N 秒内 task graph 应有新 checkpoint，否则告警 (避免静默死锁)

## 关联

- Walking Skeleton P1 design + B1-B9 全合 main 部署
- PR #2901 pre-merge gate（evaluateContractNode 引入处）
- B9 #2917 修了 graph_name dispatch 但没修 thread_id namespace（W30→W31 撞同根因不同表现）
- W31 实证 thread_id `harness-evaluate:960e97e7-...:ws1` callback ok 但 task thread 不动
