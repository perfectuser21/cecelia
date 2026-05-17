# Learning — cp-04131520-langgraph-harness

> 引入 LangGraph 替代手写 harness 状态机骨架

## 背景

当前 harness pipeline（`packages/brain/src/routes/execution.js` Layer 1→2a→2b→3a→3c→4
+ `harness-watcher.js`）是手写的状态机，跨任务通过 `callback_queue` 表 + task_type
字段实现状态机跳转。已经反复修复仍不稳定（Bug 表现：

- callback 回调链断点（PR_URL 缺失、CI 超时等触发 fix 创建链）
- 多 WS（workstream）并行时 W2/W3 PR 缺失
- evaluator/proposer 死循环超 47 轮无截断

LangGraph 原生支持：
- StateGraph + 条件边显式建模 review/eval 回路
- PostgresSaver checkpointing 实现 task.id → 自动续跑（thread_id 模型）
- `app.stream()` 一次性观测所有节点跳转，无须分散调用

### 根本原因

跨任务状态机 = 跨 HTTP/进程边界传递控制流。手写实现不得不把"下一步是什么"
散落到三个地方：

1. `routes/execution.js` 的 `harnessType === 'harness_xxx'` 大 switch（~700 行）
2. `harness-watcher.js` 的 CI/CD watch 轮询
3. `actions.createTask` 里 task_type 字段决定的派发路由

每加一个状态/条件边都需要同时改这三处，遗漏其中之一就是死循环或断链。

## 解法

把状态机的"跳转规则"集中到一个 `StateGraph` 实例（`harness-graph.js`），
状态字段集中到 `HarnessState`（Annotation.Root），让 LangGraph runtime 决定下一节点。

骨架原则：
- 节点函数只负责"执行+回写状态"，不知道下一节点是谁
- 条件边 `addConditionalEdges` 显式列出所有跳转可能（编译时校验）
- runner 用 `task.id` 作 thread_id，PostgresSaver 自动持久化中间态 → 中断后续跑

本 PR 只交付骨架（节点为 placeholder），等 Phase 1 docker-executor 完成后接入。
通过 `HARNESS_LANGGRAPH_ENABLED` 开关与老路径并行存在，灰度切换。

## 验证

`packages/brain/src/__tests__/harness-graph.test.js` 10 个 case：
- happy path: 6 节点正确流转 + trace 顺序正确
- reviewer REVISION: proposer 出现 2 次后 APPROVED
- evaluator FAIL: generator 出现 2 次后 PASS
- runner 默认 skipped；HARNESS_LANGGRAPH_ENABLED=true 时正常 stream

10/10 通过。

## 下次预防

- [ ] Phase 1 接入 docker-executor 时，节点函数禁止再"决定下一步"——必须只 return state
- [ ] 任何新跳转规则只能加在 `buildHarnessGraph()` 的 conditional edges 里，
      不允许散落到 routes/ 或 watcher 里
- [ ] PostgresSaver 上线前先在测试环境跑通 `app.getState({ thread_id })` 续跑路径
- [ ] 老路径 `routes/execution.js` 的 harness 分支保留至少一个 quarter，
      期间用 `HARNESS_LANGGRAPH_ENABLED` 灰度，新路径稳定后再删除
