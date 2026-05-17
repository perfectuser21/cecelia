# Learning: cp-05062124-w2-w5-graph-retry-interrupt

## 事件

LangGraph 1.2.9 在 Cecelia harness graph 里**用了 80%**：StateGraph、PostgresSaver、Send 并行 fanout、recursionLimit 都到位。但有 5 件可靠性原语未启用，其中两件本 PR 修：

- 14 个 graph 节点 RetryPolicy 全空 → 任何瞬时错（503/network blip）让整 initiative 失败，没有"重试一次再说"的兜底
- final_evaluate FAIL 用尽 fix_round 后 silent END，主理人不知，需手撕 SQL 才能介入

## 根本原因

**LangGraph 库的能力被自家代码遗漏使用，不是库的 bug**。三个具体疏忽：

1. **`addNode` 第 3 参数 `{ retryPolicy }` 一直没传** —— LangGraph 1.0 起就支持 per-node retry，但 Cecelia harness graph 写 `addNode('planner', runPlannerNode)` 不带任何配置，等同 `maxAttempts: 1`。一次 docker container 拉起失败就把整个 6h initiative 干掉。
2. **`interrupt()` 关键决策点没引入** —— LangGraph 在 1.2.0 引入 `interrupt()` + `Command({resume})` 配对，专为"该让人介入的关键岔路"设计。Cecelia final_evaluate 节点完全 silent，只把 verdict 写 state 跟着 graph END；主理人看 LiveMonitor 也看不出"这里应该问我"。
3. **错误分类没做** —— 没有"什么错该重试，什么错不该重试"的策略。即便加 retry 也容易把 401/403/schema parse 这类永久错也无脑重试 3 次，浪费配额还可能触发账号风控。

更深层是**官方文档在 LangGraph 1.x 仍在演化**，retryPolicy / interrupt 都是相对较新的能力，brain 代码 6 个月前写的时候这些 API 可能还是 beta，没及时回头补齐。

## 下次预防

- [ ] **集中定义 retryPolicy 而非散落每个 addNode** ——本 PR 用 `packages/brain/src/workflows/retry-policies.js` 集中三个 policy（LLM_RETRY/DB_RETRY/NO_RETRY），所有 graph 引用同一个对象。后续若调参（如 backoffFactor）不用改 14 处。
- [ ] **永久错关键词正则要严格白名单** —— PERMANENT_ERROR_RE 必须只命中真正永久的关键词（401/403/schema/parse/AbortError/GraphInterrupt）。任何模糊关键词（"failed"/"error"）都会导致瞬时错被当永久错不重试，反而劣化稳定性。本 PR 用 `\b...\b` 词边界匹配 + 单测覆盖 503/timeout/ECONNRESET 必返 true。
- [ ] **interrupt() 必须配对 Command resume 路由** —— 调 interrupt() 之前必须确认有路由能写 `Command({resume:decision})` 续跑，否则 graph 永久挂起。本 PR 同 PR 内一起加 routes/harness-interrupts.js 不分两个 PR。
- [ ] **fix_rounds_extended 状态字段要预留** —— 用户选 extend_fix_rounds 时光重置 task_loop_fix_count=0 不够，需累计 extended 次数防止无限延期。本 PR 加了 `fix_rounds_extended` 字段（每次 +3）但状态 reducer 还在 followup PR 加。
- [ ] **加厚要先减肥（策略对齐 feedback_thicken_replace_first.md）** —— 本 PR 0→thin 修复（首次显式启用 retryPolicy 和 interrupt）；未来若引入"全局 retry 策略"或"操作员决策中心"通用机制时，必须先删 retry-policies.js 和 harness-interrupts.js 路由，改用通用机制，不要两套并存累积矛盾。
- [ ] **测试用 MemorySaver 而非 PostgresSaver** —— 集成测试 mock pool 不够，需要真 checkpointer 才能验证 interrupt 暂停后的 graph state。本 PR 用 `MemorySaver` 配 `compile({ checkpointer })`，verify `graph.getState(config).tasks[].interrupts` 含 pending interrupt。
- [ ] **task_events 表是 W4 范畴，本 PR 不阻塞** —— 路由代码 INSERT/SELECT task_events 在表不存在时只 warn 不抛错；W5 不依赖 W4 表先建。Cecelia 跨 PR 依赖关系一律走"先做容错处理，再等下游 PR 补"模式。
