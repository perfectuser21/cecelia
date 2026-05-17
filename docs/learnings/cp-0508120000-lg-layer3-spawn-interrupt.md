# cp-0508120000 — Layer 3 spawnGeneratorNode 重构成 spawn-and-interrupt

**日期**: 2026-05-08
**Branch**: cp-0508120000-lg-layer3-spawn-interrupt
**触发**: LangGraph 修正 sprint Layer 3（关键改动），把生产 harness-task graph 从节点内 await 长任务反模式重构成 spawn-and-interrupt 正确模式

## 现象（pre-fix）

W8 acceptance task / Sprint 2.1a 跑到 spawn_generator 节点时：
- `await executor({task, prompt, ...})` 阻塞 5-10 分钟等 docker 容器跑完
- brain 进程任何中断（compose down/up、OOM、capability-probe rollback）= graph 内存死 = 整个 task fail
- 子节点 push 的 git 分支变孤儿，task 重新 dispatch = 整个 30 分钟工作全废

调研报告（langgraph-design-deep-dive）确认：LangGraph 节点内 await 长任务是反模式，正确做法是 `interrupt() + Command(resume=...)`，让 graph state 落 PG checkpointer，brain 重启可 resume。

## 根本原因

LangGraph 节点设计哲学：节点是函数式 transformation `(state) => state_delta`，跑 30 秒 - 几分钟。Cecelia 把节点当成"派外勤代表去出差 5-10 分钟然后回来"用，这期间 brain 进程必须不重启。任何 brain 中断 = graph 内存丢光，跨进程副作用（git push、docker spawn）变孤儿。

具体代码反模式（pre-fix `harness-task.graph.js:66-140`）：
```js
result = await executor({task, prompt, ...});  // ← 阻塞 5-10 min
```

## 修复

### 拆节点
```
[原] spawn_generator (await executor 阻塞 5-10 min) → parse_callback
[新] spawn (docker run -d 立刻返回 containerId)
   → await_callback (interrupt() yield, graph state 落 PG)
   → parse_callback
```

### spawn-and-interrupt 模式
- `spawnNode`: 写 thread lookup mapping (containerId → thread_id)，detached `docker run -d` 立刻返回
- `awaitCallbackNode`: `interrupt({type:'wait_harness_task_callback', containerId})` 让 graph yield
- task container entrypoint.sh (Stream 1 已加) 跑完 POST `/api/brain/harness/callback/:containerId`
- callback router (Stream 1) 收到后 lookup thread_id → `Command(resume=callbackResult)` 唤回 graph
- `parseCallbackNode` 之后照常处理

### fix_round loop 修复
- `fixDispatchNode` 加 `containerId: null` reset，让 spawn 重新 spawn fresh container
- 防 fix loop 时复用旧 containerId 错走旧 callback

### 配套
- `harness-thread-lookup.js` 加 `harness-task` graph dispatch 分支（之前只 dispatch walking-skeleton-1node）
- 复用 `walking_skeleton_thread_lookup` 表（避免 schema 变动；代码注释说明）
- 新 `packages/brain/src/spawn/detached.js` helper 封装 `docker run -d`

## 下次预防

- [ ] **任何节点 spawn 子进程 / 子容器都用 detached + interrupt**：不要 `await executor()` 阻塞节点 5+ 分钟
- [ ] **thread_id 命名固定**：`harness-task:initiativeId:taskId` 让 callback router 找对应 graph
- [ ] **fix_round loop 必须 reset containerId**：避免复用旧容器
- [ ] **跨进程副作用必须可重放**：spawn 容器有幂等门，重 spawn 用新 containerId
- [ ] **新生产节点必须配 graph e2e test**：模拟 spawn → interrupt → resume → end，避免只测 unit 漏掉路由

## 测试

- 28 个 unit test PASS（含 4 个完整 e2e graph：happy / fix loop / no_pr / container error）
- harness-initiative.graph.full.test.js 18 pass + 3 skipped
- harness-thread-lookup.test.js 6/6 pass

## 文件改动

- `packages/brain/src/workflows/harness-task.graph.js` 重构（+200 行）
- `packages/brain/src/spawn/detached.js` 新建（docker run -d helper）
- `packages/brain/src/lib/harness-thread-lookup.js` 加 harness-task dispatch 分支
- `packages/brain/src/workflows/__tests__/harness-task.graph.test.js` 加 e2e graph test
- `packages/brain/src/workflows/harness-initiative.graph.js` 跟随路由名调整
- brain version 1.229.1 → 1.230.0 (major: 行为模式变更)

## 关联

完整 LangGraph 修正 sprint：
- 5 stream PR：#2840 (git-fence) + #2841 (callback router) + #2842 (idempotency) + #2843 (durability) + #2844 (walking skeleton)
- Layer 3 (本 PR)
- Layer 4: W8 acceptance + brain kill resume 真机验收

## 中途意外

agent 在 Green 阶段挂在 API 500 error（27 分钟、112 工具调用）。代码已写完，测试已改完，没 commit。Controller 接管：
1. 跑测试确认 28+18+6 全 PASS
2. commit Green
3. bump version
4. 写 Learning（本文件）
5. push + 创 PR + auto-merge

教训：长跑 agent 应该每个 task 完成后立刻 push（不只是 commit），防 API 错误丢工作。
