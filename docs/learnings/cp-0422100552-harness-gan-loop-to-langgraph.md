# harness-gan-loop 迁 LangGraph + PostgresSaver（2026-04-22）

## 做了什么

把 `packages/brain/src/harness-gan-loop.js` 的 173 行 `while (true)` 循环，替换成 `harness-gan-graph.js` 里的 LangGraph 2 节点 StateGraph（proposer ↔ reviewer + 条件边 APPROVED→END / REVISION→proposer）。在 `executor.js` 的 `harness_initiative` 分支构造 `PostgresSaver.fromConnString` 并注入，`task.id` 作为 langgraph `thread_id`。

Brain 重启后下次 tick 派发同一 Initiative，LangGraph 读 `checkpoints` 表的最后一个节点 state 续跑，不再从 Planner 重头。

### 根本原因

2026-04-19 Harness v2 M2 引入 `harness-initiative-runner.js` + `harness-gan-loop.js` 时，选择手写 `while` 循环而不是复用 2026-04-16 PR #2385 已上线的 LangGraph 基础设施（PostgresSaver 同日在 PR `cp-04191125` 接通）。结果 Phase A 任何中断（Brain 被 macOS jetsam 杀、launchd restart）都导致 Initiative 从 Round 1 重头，单轮 43 分钟的 Pipeline 每次挂都丢整条进度。

2026-04-21 实测：Initiative `2303a935` 跑到 Round 11 被 SIGKILL 中断，累计浪费 103 分钟 Claude CLI + 估算 $30-50 tokens，然后 Brain StartupRecovery 清了 worktree，本地 contract R4-R11 的 commits 连 push 都没推过直接消失。

### 下次预防

- [ ] 任何长周期（> 10 min）的状态机，凡有"中途可能中断"风险，强制走 LangGraph + checkpointer
- [ ] 新写 orchestration 逻辑前 grep `@langchain/langgraph` 看仓库里现有图，能复用不另造
- [ ] code review 看到 `while (true) { await step }` 模式立刻标红
- [ ] Brain 重启场景的集成测试必须覆盖 Phase A GAN（下一 Sprint 加）

## 技术要点

- LangGraph `Annotation.Root` 每个字段显式 `reducer: (_old, neu) => neu` 是"覆写"语义；不写 reducer 默认 append 不可用。
- `thread_id` 必须是 string：`String(taskId)`（Postgres 存 text 列）。
- PostgresSaver `.setup()` 幂等但有 RTT 成本，每次 executor.js 入口调一次可接受。
- `recursionLimit` 给 100（vs LangGraph 默认 25），GAN 预算 cap 才是真的硬保护。
- MemorySaver fallback 只用于单元测试；executor.js 里 setup 失败降级打 warn 不阻塞，但生产必须观察告警。
- 测试文件里用 `vi.mock('../../harness-gan-loop.js')` 这类路径精确匹配的 mock，改 import 路径时必须同步更新 mock 路径 —— 本次改动涉及 `__tests__/integration/harness-initiative-runner.integration.test.js` 和 `__tests__/harness-initiative-runner-gan.test.js` 两处。

## 冒烟验证

```bash
# 1. setup 能建表（幂等）
node --input-type=module -e "const {PostgresSaver}=await import('@langchain/langgraph-checkpoint-postgres');const c=PostgresSaver.fromConnString('postgresql://cecelia@localhost:5432/cecelia');await c.setup();console.log('OK')"

# 2. checkpoints 表存在
psql -d cecelia -c '\dt checkpoint*'

# 3. 单元测试 20/20 绿
cd packages/brain && npx vitest run src/__tests__/harness-gan-graph.test.js

# 4. 相关测试全绿（30/30）
cd packages/brain && npx vitest run \
  src/__tests__/harness-gan-graph.test.js \
  src/__tests__/harness-initiative-runner-gan.test.js \
  src/__tests__/integration/harness-initiative-runner.integration.test.js \
  src/__tests__/executor-langgraph-checkpointer.test.js

# 5. 真机验证（PR 合入后）：
#    重跑 Initiative 2303a935，中途 kill Brain
#    launchd 重启后，psql -d cecelia -c "SELECT metadata FROM checkpoints WHERE thread_id='2303a935-...' ORDER BY checkpoint_id DESC LIMIT 1"
#    应有行且 state 包含 round > 1
```
