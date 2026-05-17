# LangGraph 修正 Stream 2 — durability:'sync' + 删 MemorySaver fallback

## 背景

LangGraph compile() 默认 `durability='async'`，写 checkpoint 是异步的：节点
return 后立刻继续下一节点，checkpoint 落 PG 在后台。如果 brain 进程在节点
之间正好崩溃（OOM / OS kill / docker restart），最近一个 checkpoint 还没
真正落到 PG，重启后从更老的 checkpoint 续跑 → 丢一段执行 → ghost task。

另外 `harness-gan.graph.js:540` 历史上写了 `|| new MemorySaver()` 静默
fallback：调用方忘传 PostgresSaver 时，悄悄退回内存 checkpointer。brain
进程一重启，整个 GAN 循环 state 全丢，PR 已 push 但任务记录为空 → 也是
ghost task。

## 变更

### 6 处 graph .compile() 加 durability:'sync'

- `consciousness.graph.js:151` — Brain 主意识 graph
- `dev-task.graph.js:76` — /dev 任务执行 graph
- `harness-gan.graph.js:540` — GAN 对抗合同 graph（同时删 fallback）
- `harness-task.graph.js:270` — Harness 单 task graph
- `harness-initiative.graph.js:730` — Phase A graph
- `harness-initiative.graph.js:1389` — Full graph

不动 `harness-initiative.graph.js:890`（嵌套 subgraph 占位 compile，
checkpointer 由父 graph 控制，子 graph 加 durability 反而冲突）。

### harness-gan.graph.js 删 MemorySaver fallback

```diff
-import { ..., MemorySaver } from '@langchain/langgraph';
+import { ..., } from '@langchain/langgraph';
...
+if (!checkpointer) {
+  throw new Error("runGanContractGraph: checkpointer is required (PostgresSaver). MemorySaver fallback removed in v1.229.0 — 生产必须显式传 PG checkpointer 防止 brain restart 丢 state（ghost task 根因）。");
+}
-const app = graph.compile({ checkpointer: checkpointer || new MemorySaver() });
+const app = graph.compile({ checkpointer, durability: 'sync' });
```

### 单测

新增 `src/workflows/__tests__/durability-config.test.js` 守门：
- 5 个 graph 文件顶层 compile 必须含 `durability:'sync'`
- harness-gan.graph.js 不含 `|| new MemorySaver()`
- harness-gan.graph.js 不再 import MemorySaver
- runGanContractGraph 在 checkpointer 缺失时 throw

更新 `src/__tests__/harness-gan-graph.test.js` makeOpts() 注入
`checkpointer: new MemorySaver()`（单测里 mock PG 仍 OK）。

## 根本原因

1. **default durability='async' 不是生产 safe 默认**：LangGraph 文档把
   async 标为更高吞吐量默认，但 brain 这种长跑 + 重启容忍场景必须 sync。
   不显式声明就吃了默认。
2. **fallback 模式是 debt**：`|| new MemorySaver()` 让调用方忘传
   checkpointer 时无声退化。生产代码任何 silent fallback 都是定时炸弹，
   必须 fail-fast。

## 下次预防

- [ ] 生产 LangGraph compile 必须显式 `durability:'sync'`，加 CI grep 守门
- [ ] 永不在 PostgresSaver 缺失时 fallback MemorySaver（生产代码层面）
- [ ] 任何 `|| <silent fallback>` 模式 code review 重点盘问
- [ ] 单测里允许 `new MemorySaver()` mock PG（保留 fixture），但生产代码层
      禁止 import MemorySaver（durability-config.test.js 守门）
