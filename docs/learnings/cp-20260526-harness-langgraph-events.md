# Learning: Harness Pipeline Dashboard 阶段全 not_started

## 根本原因
`GET /api/brain/harness-pipelines` 端点的 `summarizeLangGraphEvents()` 函数依赖
`cecelia_events` 表中的 `langgraph_step` 事件来判断每个 pipeline 阶段状态。
但 harness LangGraph 图（harness-initiative.graph.js）从未调用任何 INSERT INTO cecelia_events，
导致 `eventsByTask` 始终为空 Map，所有阶段默认返回 `not_started`。

前端 Pipeline 可视化 PR 建立了完整的查询和展示层，但缺少图执行层的事件写入，属于基础设施断链。

## 下次预防

- [ ] 新建依赖外部事件表的 API 端点时，同步检查"事件写入方"是否真正存在对应的 INSERT
- [ ] Pipeline 可视化 sprint 的 DoD 应包含一条 [BEHAVIOR]：`SELECT COUNT(*) FROM cecelia_events WHERE event_type='langgraph_step'` 在跑完一次 harness 后 > 0
- [ ] 如果 `summarizeLangGraphEvents(events)` 返回 null（events 为空），API 返回应区分「老任务无事件」vs「新任务事件丢失」两种情况，方便诊断

## 修复点
`harness-initiative.graph.js` 新增 `emitLangGraphStep()` 辅助函数，
在 `runGanLoopNode`（proposer/reviewer）、`fanoutPassthroughNode`（generator）、
`finalE2eNode`（evaluator）、`reportNode`（report）四处写入事件。
