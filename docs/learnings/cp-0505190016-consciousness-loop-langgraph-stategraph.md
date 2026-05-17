# Learning: consciousness-loop LangGraph StateGraph 改造

## 根本原因

Brain 内部意识循环（consciousness-loop.js）每 20 分钟串行调 4 次 LLM，无任何 checkpoint 机制。Brain 崩溃（容器重启、OOM、超时）后整个 4 步重跑，thalamus/rumination 等耗时操作浪费算力，且 planNextTask 可能创建重复任务。

## 修复方式

将 `_doConsciousnessWork()` 包装成 LangGraph StateGraph（consciousness.graph.js），复用现有 PG Checkpointer（migration 244 表）。thread_id = `consciousness:{epochMs}`，存入 brain_guidance（key = `consciousness:active_thread`），Brain 重启后从断点续跑。

## 设计关键决策

1. **不走 runWorkflow()**：runWorkflow 强依赖 taskId/attemptN，consciousness 是系统级循环，无 task 概念。直接 `compiledGraph.invoke()`。
2. **thread_id 不用固定值**：fixed `consciousness:1` 在图完成后再次 invoke 行为不确定。使用 rotating epochMs + brain_guidance 存储，语义清晰。
3. **_isRunning 保留**：与 checkpointer 正交。前者防进程内并发，后者防崩溃重启丢步骤。
4. **rumination fire-and-forget 保留**：rumination 在 StateGraph node 内不 await，节点立即返回 checkpoint，不因 rumination 10 分钟超时阻塞后续步骤。

## 下次预防

- [ ] 新增 LLM 链路时，默认用 StateGraph + PG Checkpointer（不裸跑）
- [ ] 任何超过 2 步的串行 LLM 调用都是 StateGraph 候选
- [ ] 崩溃恢复 thread_id 语义：rotating > fixed（fixed 图完成后行为不确定）
