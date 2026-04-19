# Learning: LangGraph harness pipeline 注入 PostgresSaver 实现断点续跑

**日期**: 2026-04-19
**分支**: cp-0419112540-langgraph-postgres-checkpoint
**Task**: b4d06983-13ee-4f13-9419-a372ab205b53

## 做了什么

在 `packages/brain/src/executor.js` 的 LangGraph 分支（`task.task_type === 'harness_planner' && isLangGraphEnabled()`）里，动态 import `@langchain/langgraph-checkpoint-postgres`，用 `PostgresSaver.fromConnString(DATABASE_URL || 'postgresql://cecelia@localhost:5432/cecelia')` 构造 checkpointer，调 `setup()` 幂等建表（`checkpoints` / `checkpoint_blobs` / `checkpoint_writes` / `checkpoint_migrations` 四张），然后通过 `opts.checkpointer` 注入 `runHarnessPipeline`。

`task.id` 被 runner 作为 `thread_id` 传给 `app.stream({ configurable: { thread_id } })`，这就是 PostgresSaver 的 resume key——Brain 重启后下一次同一 thread_id 调 stream 会从最后一个 checkpoint 继续。

### 根本原因

昨天 PR #2395 接通 LangGraph 时，`harness-graph-runner.js` 设计上已支持 `opts.checkpointer` 参数，但 `executor.js` 的调用方没传，`harness-graph.js:595` fallback 到 `new MemorySaver()`——state 只活在当前 Node 进程内存里。一次 harness_planner pipeline 可达 43 分钟，Brain 进程只要重启（OOM / 手动 pkill / launchctl reload），整条流水线就从 planner 重跑，前面烧掉的 Claude Code tokens + Docker 容器全白费。

问题性质：**架构已备好接口，调用方漏传参数**——不是缺能力，是缺连接。

### 修复动作

1. `executor.js` LangGraph 分支新增 3 行：动态 import PostgresSaver + fromConnString + setup()
2. 在 `runHarnessPipeline(task, { env, onStep })` 的 opts 里追加 `checkpointer,`
3. 新增单元测试 `executor-langgraph-checkpointer.test.js`，用源码结构断言（readFileSync + 正则）而非 spawn executor.js（后者会连 DB、依赖重）：
   - 确认正确 import PostgresSaver
   - setup() 在 runHarnessPipeline 之前调用
   - checkpointer 作为 opts 传入
   - DATABASE_URL fallback 指向本机 cecelia

### 下次预防

- [ ] 后续如果新增类似"支持 opts 但调用方没传"的场景（比如 harness 未来加 `opts.cache` / `opts.tracer`），直接在 runner 侧写 console.warn 提示调用方未注入，不默默走 fallback
- [ ] LangGraph 相关的可选参数（checkpointer / tracer / store）应在 CURRENT_STATE.md 里集中记录"是否生产启用"
- [ ] 任何长周期 pipeline 接入新基础设施（LangGraph / Temporal / Airflow）时，checkpointer/持久化必须与功能一起上线，不允许"先跑通再加持久化"—— MemorySaver 在生产环境永远是 bug

## 技术要点

- `PostgresSaver.fromConnString(url)` 是同步构造，`setup()` 是 async（建表需要 DB RTT）
- setup() 幂等（内部 `CREATE TABLE IF NOT EXISTS`），每次 runHarnessPipeline 前调一次成本可忽略
- 依赖在 PR #2385 已装好（`@langchain/langgraph-checkpoint-postgres@^1.0.1`），本次不碰 package.json
- 不改 harness-graph-runner.js 或 harness-graph.js 的签名——MemorySaver fallback 保留给单元测试注入

## 冒烟验证

```bash
# 1. 手动跑 setup() 确认表建了
node --input-type=module -e "const {PostgresSaver}=await import('@langchain/langgraph-checkpoint-postgres');const c=PostgresSaver.fromConnString('postgresql://cecelia@localhost:5432/cecelia');await c.setup();console.log('OK')"

# 2. 查表
psql postgresql://cecelia@localhost:5432/cecelia -c "\dt checkpoint*"
# 预期：checkpoints / checkpoint_blobs / checkpoint_writes / checkpoint_migrations 四张
```

已验证通过。
