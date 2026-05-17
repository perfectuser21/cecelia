## LangGraph 修正 Sprint Stream 1 — callback router (2026-05-08)

### 背景

调研报告确认 LangGraph 长时任务正确用法是 `interrupt()` + callback resume：节点内 spawn docker 后立刻 `interrupt({type:'wait_callback', containerId})` 让 graph yield，graph state 落 PostgresSaver。Brain 进程可重启，因为 graph state 在 PG。task container 跑完发 HTTP callback，brain 收 callback → lookup containerId 对应 thread_id → `compiledGraph.invoke(new Command({resume: result}), {configurable: {thread_id}})` 唤回 graph。

本 PR 是 5-stream sprint 的 Stream 1，搭 callback router 架子；后续 Layer 3 spawn 节点重构 + Stream 5 PG 表落地后即可端到端跑通。

### 根本原因

LangGraph 节点内 `await` 长任务（docker spawn + container 跑 5-30 分钟）是反模式：
1. Brain 进程一旦重启，await 中的 promise 丢失，无法续跑
2. graph state 在内存而非 checkpointer，重启即裸奔
3. 节点 await 阻塞 graph engine，多 thread 并发能力消失

正确做法：节点内只发 spawn 命令然后立刻 `interrupt()`，把"等结果"这件事交给外部回调机制（PostgresSaver 持久化 state，HTTP callback 唤醒 graph）。

### 实现要点

- `POST /api/brain/harness/callback/:containerId`：从请求体读取 `{result, error, exit_code, stdout}`，先 lookup thread，再用 `Command({resume: ...})` 唤回 graph
- `lookupHarnessThread` 当前是 stub（永远 null → 404），因为真实 `containerId → threadId` 映射要在 Layer 3 spawn 节点重构时插入（spawn 时写 `harness_callback_lookups` 表）
- `cecelia-runner/entrypoint.sh` 改造：harness 任务（`CECELIA_TASK_ID + HARNESS_NODE` 都设置）跑完后用 curl POST callback；非 harness 任务保持原 `exec claude` 路径，零变更
- 路由器挂在 `/api/brain` 命名空间下（路径 `/harness/callback/:containerId`），按 specific-before-generic 顺序排在 `harnessRoutes` 之前

### 下次预防

- [ ] 跨进程异步任务（docker spawn / 远程 RPC / 长 IO）必须 spawn-then-interrupt + callback router，禁止节点内 await
- [ ] callback router 路由注册必须有单元测试覆盖（200/404/500/400 + Router export 形态）
- [ ] PostgresSaver checkpointer 必须配置：graph state 不能只在内存，否则 brain 一重启全部丢失
- [ ] entrypoint.sh 修改时禁用 `exec` 替换进程的写法 — 改成捕获子进程 exit code 后再做收尾（callback / 日志），否则收尾代码永远不会跑
- [ ] 加新路由时注意 mount 顺序：specific path 必须排在 generic path 之前（Express 按注册顺序匹配）
