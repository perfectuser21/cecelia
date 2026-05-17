# Brain Orchestrator v2 — 三层分离架构设计

**日期**: 2026-04-22
**作者**: Alex + Claude Opus 4.7
**状态**: 评审决策已定（见 §12）— 可拆 Initiative 进入执行

---

## 1. 目的

把 Brain 从 "scheduler + orchestrator + executor + monitor 四合一的单体" 重构成 **三层分离架构**，对齐 LangGraph / Temporal / Argo 等行业标准 workflow 引擎的模式。让 sub-pipeline（harness / content-pipeline / 未来任何新流水线）统一复用 Brain 的治理能力（账号轮换、配额、熔断、日志、账单归账），**不再各自造半个轮子**。

本文档 **不是实现手册**，是架构意图与边界定义。对应的实现 Plan 拆成 P1-P4 四个独立阶段，每个阶段独立 ship。

---

## 2. 背景与现状

### 2.1 今天 Brain 的角色清单

Brain 进程（`packages/brain/`, port 5221）当前至少承载 15 种角色：

| 角色 | 代码位置 | 边界问题 |
|---|---|---|
| 调度器 | `tick.js` | 每 5s 决定派什么 |
| 派发器 | `executor.js::dispatchTask` | 把任务转成 docker run |
| 资源控制 | `slot-allocator.js`, `account-usage.js` | 仅 dispatcher 调用 |
| 工作流引擎 | `harness-initiative-runner.js`, `content-pipeline-graph-runner.js` | 各自为政 |
| 图执行器 | `harness-gan-graph.js`, `content-pipeline-graph.js` (LangGraph) | 各自用 |
| 健康监控 | `watchdog.js`, `shepherd`, `pipeline-patrol` | ad-hoc 后台 |
| 熔断 | 散落各处 | 无统一模式 |
| 状态机 | `harness-phase-advancer.js`, `initiative-closer.js` | 硬编码状态转移 |
| 知识库 | `working_memory`, `decisions`, `dev-records` | 多张表，职责相近 |
| API server | port 5221 routes | OK |
| Notification hub | `notifier.js` (feishu) | OK |
| Billing | 散落 task payload | `dispatched_account` 只在 dispatcher 路径写 |

### 2.2 根本病根：**两条派发路径，只有一条有智能治理**

```
任务 → tick.js
         │
         ▼
  executor.dispatchTask
         │
         ├── 普通 task ──────────► line 3041-3076 智能层
         │                          ✓ selectBestAccount
         │                          ✓ isSpendingCapped fallback
         │                          ✓ isAuthFailed fallback
         │                          ✓ cascade 降级链
         │                          ✓ dispatched_account 归账
         │                          然后 executeInDocker
         │
         └── harness_initiative / harness_task  (line 2822 early-return)
              │
              └─► harness-initiative-runner / harness-gan-graph / harness-task-dispatch
                    │
                    └─► 直接调 executeInDocker({ env: { CECELIA_CREDENTIALS: 'account1' }})
                          ✗ 绕过智能层
                          ✗ 硬编码 account1
                          ✗ 无 cap 检测
                          ✗ 账单可能错账号
```

同理 content-pipeline 也走这条"裸 executeInDocker"路径。

### 2.3 今天 P0 已做（PR #2534）

把 `selectBestAccount + isSpendingCapped + isAuthFailed` 下沉到 `executeInDocker()` 入口，变成**所有 spawn 通用 middleware**。这是 v2 架构的**第一块砖**，但只解决了"账号轮换"一个维度。

今天**还没做**的 v2 部分：
- 其它横切能力（cascade / cap marking / retry / cost tracking / billing 归账）仍绑在 dispatchTask
- LangGraph resume 路径（Brain 重启 workflow 能否从 checkpoint 接着跑）
- 新 pipeline 接入成本没降
- Brain 自己的 "workflow vs scheduler vs executor" 边界仍糊

### 2.4 今天暴露的其它硬伤（v2 路线中会解决）

| 问题 | 对应 v2 阶段 |
|---|---|
| LangGraph `graph.invoke(freshState, ...)` 覆盖 checkpoint → 无法 resume | P3 Workflow Registry 里强制传 `null` + 显式 config.configurable.thread_id |
| Brain 83 分钟自杀（tick watchdog FORCE-RELEASE） | P4 Observer 分离：tick 不再嵌入长任务 await |
| shepherd `repeated_failure` 误 quarantine 活跃 task | P4 Observer 读 DB 当前状态，不基于历史计数 |
| `markSpendingCap` 只在 callback 路径被调，harness 路径 429 不记 | P2 Spawn Policy Layer 把 429 检测纳入 middleware |
| `dispatched_account` 只在 dispatcher 路径写 | P2 Spawn Policy Layer 统一写 |

---

## 3. 目标与非目标

### 3.1 目标

**T1**: 把 Brain 拆成清晰的三层，每层职责单一、可独立测试：
- **Scheduler**: 决定"何时启动 workflow"
- **Orchestrator**: 决定"workflow 内部怎么走"
- **Executor**: 决定"一次 spawn 怎么跑"

**T2**: 所有 spawn 走同一个 API（`spawn()`）+ 同一套中间件链（账号 / cascade / cap / retry / logging / 归账）。任何新 pipeline 接入成本 = "声明一个 graph 文件 + 调 spawn()"。

**T3**: LangGraph checkpoint + resume 真正生效 — Brain 崩溃重启，workflow 从最后 checkpoint 继续，不从头跑。

**T4**: Observer（watchdog / shepherd / patrol）从"派发链路里的阻塞点"变成"读 DB 当前状态的旁观者"，tick 永不阻塞超过 5 秒。**硬规矩**：workflow graph node 只允许 async I/O，禁止 sync 计算 > 50ms（大 JSON parse / regex / 密集循环要 `setImmediate` 让出 event loop）。违反规则的 node 在 P4 CI 加 benchmark 兜底。

### 3.2 非目标（v2 不做）

- 换掉 Postgres（workflow state / tasks / checkpoints 继续用 Postgres）
- 引入 Temporal / Argo / k8s（保持 Docker + 自研 orchestrator）
- 重写 account-usage / slot-allocator（继续用现有 API）
- 改 Brain 的 API 路由（port 5221 对外接口不变）
- 改 Dashboard / CLI 等上层（只要 API 兼容即可）

---

## 4. 三层架构设计

```
┌──────────────────────────────────────────────────────────────┐
│ Layer 1: Scheduler  (packages/brain/src/scheduler/)          │
│   职责：决定 "何时启动 workflow"                              │
│   实现：tick.js（瘦身后）+ cron                              │
│   输出：enqueue(workflow_name, input)                        │
│   不包含：具体派发、账号选择、子 workflow 逻辑                │
└────────────────────────┬─────────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────────┐
│ Layer 2: Orchestrator  (packages/brain/src/orchestrator/)    │
│   职责：决定 "workflow 内部怎么走"                            │
│   实现：graph-runtime.js (LangGraph wrapper)                 │
│   数据：workflows/*.graph.js（声明式）+ Postgres checkpointer │
│   输出：调 Layer 3 spawn()                                   │
│   不包含：docker 细节、账号选择逻辑、DB I/O                   │
└────────────────────────┬─────────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────────┐
│ Layer 3: Executor  (packages/brain/src/spawn/)               │
│   职责：决定 "一次 spawn 怎么跑"                              │
│   实现：spawn.js（唯一对外 API）+ middleware/ 链             │
│   中间件：外层（cost-cap/logging/billing/pre）                │
│          + 内层 attempt-loop（rotation × cascade × run × 429）│
│   输出：docker run                                           │
│   不包含：workflow 状态、调度策略                            │
└──────────────────────────────────────────────────────────────┘

  Cross-Cutting (Observers — packages/brain/src/observers/)
  只读 DB 当前状态，不参与派发链路
  ┌─────────┐ ┌────────┐ ┌──────────┐ ┌──────────┐
  │Watchdog │ │Shepherd│ │Cost Track│ │Analytics │
  └─────────┘ └────────┘ └──────────┘ └──────────┘
```

### 4.1 关键原则

1. **单向依赖**：Layer 1 → 2 → 3，不允许反向（Scheduler 调 Orchestrator，Orchestrator 调 Executor）
2. **唯一 spawn 原语**：任何地方要跑 docker 只能调 `spawn()`，没有"escape hatch"（直接调 `executeInDocker`）
3. **Workflow = graph 文件**：所有多步骤任务都是 LangGraph 图；即便单步也写成 1-node graph
4. **Observer 只读**：watchdog / shepherd 不嵌入派发链，只读 DB 状态纠偏
5. **Checkpoint 全自动**：orchestrator runtime 强制所有 graph 带 PostgresSaver，resume 是默认行为

---

## 5. Layer 3 — Spawn Policy Layer（核心）

### 5.1 对外 API

`packages/brain/src/spawn/spawn.js`:

```js
/**
 * 唯一的 spawn 原语 — Orchestrator / tick / observer 要跑 docker 都调它。
 *
 * @param {object} opts
 * @param {object} opts.task        — { id, task_type }
 * @param {string} opts.skill       — skill slash-command（如 '/harness-planner'）
 * @param {string} opts.prompt      — agent 收到的初始 prompt
 * @param {object} [opts.env]       — 显式 env（middleware 会尊重非空项）
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.cascade]   — 模型降级链 override
 * @param {object} [opts.worktree]  — { path, branch } 挂载点
 *
 * @returns {Promise<{ exit_code, stdout, stderr, duration_ms, account_used, model_used, cost_usd }>}
 */
export async function spawn(opts) { ... }
```

**所有当前直接调 `executeInDocker` 的地方都迁到 `spawn()`**。`executeInDocker` 变成 `spawn/` 内部实现细节，不再对外导出。

### 5.2 Middleware 结构（两层洋葱）

存放：`packages/brain/src/spawn/middleware/`

**关键洞察**：账号轮换 / 模型降级 / 429 重试本质是**同一个"尝试循环"**——429 失败时要能回到循环顶重选账号或降模型，不是单向 bubble。所以 middleware 必须分两层：

```
spawn(opts)
 ├─ 外层（每次 spawn 只执行一次，Koa 洋葱模型）
 │    1. cost-cap.js     超预算直接拒绝（读 budget table）
 │    2. spawn-pre.js    写 prompt / cidfile / forensic log
 │    3. logging.js      统一 spawn 入口 log + metric
 │    4. billing.js      spawn 结束后写 dispatched_account / cost_usd
 │
 └─ 内层 attempt-loop（可能迭代 N 次，直到成功或候选穷尽）
      ┌────────────────────────────────────────────────────┐
      │ for (account, model) in cascade × rotation:        │
      │   a. account-rotation.js  选账号（skip capped/auth）│
      │   b. cascade.js           选模型 override           │
      │   c. resource-tier.js     内存/CPU tier             │
      │   d. docker-run.js        实际 docker run           │
      │   e. cap-marking.js       stdout 检测 429/auth 失败 │
      │        → markSpendingCap / markAuthFailed           │
      │        → continue 下一候选                          │
      │   f. retry-circuit.js     transient 失败有限次重试  │
      │ 如果候选全部耗尽：raise NoViableCandidateError      │
      └────────────────────────────────────────────────────┘
```

**外层 middleware 签名**：`async (ctx, next) => { ... await next(); ... }`（Koa 风格）
**内层 attempt-loop** 是显式 for 循环，不是 middleware 链——每次 iteration 产生一个候选 `(account, model)`，跑一次 docker-run，根据结果决定 retry / next candidate / fail。

候选遍历顺序见 §5.3。

### 5.2.1 与旧代码的映射

| 层 | 组件 | 对应旧代码 |
|---|---|---|
| 外层 | cost-cap | 零散各处的 costUsd 累加（新建） |
| 外层 | spawn-pre | docker-executor.js 前置逻辑 |
| 外层 | logging | 散落 console.log |
| 外层 | billing | executor.js:3083 `dispatched_account` 写入 |
| 内层 | account-rotation | PR #2534 已落 executeInDocker 入口（保留） |
| 内层 | cascade | executor.js:3072 `getCascadeForTask` |
| 内层 | resource-tier | docker-executor.js `resolveResourceTier` |
| 内层 | docker-run | docker-executor.js 核心（抽出） |
| 内层 | cap-marking | routes/execution.js:798 `markSpendingCap`（搬到这层） |
| 内层 | retry-circuit | 散落 ad-hoc（归一） |

### 5.3 候选遍历顺序（cascade × rotation）

**原则：质量优先于成本**——主力模型是 Sonnet，账号是囤出来的备胎。先把所有账号的 Sonnet 用完，再降级到 Opus。

**默认候选序列**（按 attempt-loop 迭代顺序）：

```
1. account1 / sonnet
2. account2 / sonnet
3. account3 / sonnet      ← 先横切：把 Sonnet 的三把钥匙都试过
4. account1 / opus
5. account2 / opus
6. account3 / opus        ← 再横切 Opus
7. account1 / haiku
8. account2 / haiku
9. account3 / haiku
10. minimax               ← 最后兜底（如果 cascade 配置启用）
```

每步 attempt-loop 进入 `account-rotation` 会 skip 掉 capped / auth-failed 的账号，直接跳到下一候选。

**显式 override 优先级**：

- Caller 传 `opts.env.CECELIA_CREDENTIALS=accountX`
  → attempt-loop 尝试 `(accountX, sonnet)`
  → 若 accountX capped/auth-failed：**保留指定模型，横切其它账号**（accountY/sonnet → accountZ/sonnet）
  → 不要自作主张降级模型（用户显式指定账号通常是为了归账/调试）
- Caller 传 `opts.env.CLAUDE_MODEL_OVERRIDE=opus`
  → attempt-loop 强制 `model=opus`，只做账号横切，不做 cascade 降级
- Caller 同时传账号和模型：只尝试一次，失败就 raise（完全由 caller 负责）
- Caller 都不传：走上面的默认序列

### 5.4 验收

- `executeInDocker` 不再导出，所有外部 import 切到 `spawn()`
- 所有 7 处历史硬编码 `account1` 已删（PR #2534 做了 4 处 harness，剩 `executor.js:2856/3045`, `content-pipeline-graph-runner.js:70`）
- 新增测试：每个 middleware 独立单元测试 + spawn.js 端到端集成测试
- 重建 Brain image + 冒烟 harness E2E 不挂账号问题

---

## 6. Layer 2 — Orchestrator（Workflow Registry）

### 6.1 workflow 目录结构

```
packages/brain/src/workflows/
├── dev-task.graph.js          ← 普通 dev 任务（单 node graph）
├── harness-initiative.graph.js ← Planner → GAN → Phase B → Phase C
├── harness-gan.graph.js        ← subgraph: Proposer ↔ Reviewer 循环
├── harness-task.graph.js       ← subgraph: Generator → CI wait → merge
├── content-pipeline.graph.js   ← 6 步内容流水线
├── strategy-session.graph.js
└── index.js                    ← export { getWorkflow(name), listWorkflows() }
```

### 6.2 graph 文件约定

```js
// workflows/harness-initiative.graph.js
import { StateGraph } from '@langchain/langgraph';
import { spawn } from '../spawn/spawn.js';

export const harnessInitiativeGraph = new StateGraph({
  channels: {
    initiativeId: null,
    prdContent: null,
    contractContent: null,
    round: 0,
    verdict: null,
    taskIds: [],
    // ...
  }
})
  .addNode('planner', async (state) => {
    const result = await spawn({
      task: { id: state.initiativeId, task_type: 'harness_planner' },
      skill: '/harness-planner',
      prompt: buildPlannerPrompt(state),
      // 注意：不传 env.CECELIA_CREDENTIALS — middleware 自动选
    });
    return { prdContent: result.stdout };
  })
  .addNode('gan', ganSubgraph)  // subgraph 组合
  .addEdge('planner', 'gan')
  .addConditionalEdges('gan', (state) =>
    state.verdict === 'APPROVED' ? 'phase_b' : 'gan'
  )
  .addNode('phase_b', phaseBTaskLoop)
  // ...
  .compile({ checkpointer: pgCheckpointer });  // 注意：强制 checkpointer
```

### 6.3 runtime — `graph-runtime.js`

**thread_id 语义**：

- 规则：**`thread_id = task.id + ':' + attempt_n`**（例如 `task_abc123:1`）
- 任务首次派发：`attempt_n = 1`，新 thread
- 任务 retry（Brain 主动重派、shepherd 放行、用户手动 re-dispatch）：`attempt_n` 递增，**新 thread、新 checkpoint、从头跑**
- 任务**同一 attempt 内 Brain 崩溃重启**：thread_id 不变，自动 resume 从最后 checkpoint 接着跑

**为啥不复用 checkpoint**？老 checkpoint 里藏着上一次失败时的脏状态（中间变量、节点输出）。硬接着跑等于带着污染的上下文继续——定位 bug 会疯，而且违反"retry 应该是重置尝试"的直觉。干净重来多花一点 LLM token，换来确定性语义，值。

```js
/**
 * 唯一的 workflow 运行入口。
 *
 * 关键行为：
 *   - thread_id 格式强制 {task_id}:{attempt_n}
 *   - 若 thread_id 已有 checkpoint → 自动 resume（Brain 崩溃重启场景）
 *   - 否则从 input 起跑
 *   - 统一 Postgres checkpointer（一次配置，所有 graph 共用）
 *   - 自动 retry + 超时保护
 */
export async function runWorkflow(workflowName, taskId, attemptN, input = null) {
  const graph = getWorkflow(workflowName);
  const threadId = `${taskId}:${attemptN}`;
  const config = { configurable: { thread_id: threadId } };

  // 自动 resume：若 thread 有 checkpoint（Brain 崩溃重启），input=null 让 LangGraph 从 checkpoint 恢复
  // 注意：retry 场景 caller 负责递增 attempt_n，这里不会匹配到老 checkpoint
  const hasCheckpoint = await checkpointerHasThread(threadId);
  const actualInput = hasCheckpoint ? null : input;

  return await graph.invoke(actualInput, config);
}
```

**数据库影响**：`tasks` 表增加 `attempt_n` 列（默认 1），retry 时 `UPDATE tasks SET attempt_n = attempt_n + 1, status = 'queued'`。老 checkpoint 不主动清理（留给后续分析 / 观察之用），由 checkpoint 存活期 + Postgres TTL 自然回收。

### 6.4 Scheduler 接入

tick.js 瘦身后 **不再调 runGanContractGraph / runContentPipeline 等具体 runner**。它只做：

```js
// scheduler/tick.js 核心逻辑
async function tick() {
  const task = await selectNextDispatchableTask(...);
  if (!task) return;

  // 按 task_type 路由到对应 workflow
  const workflowName = taskTypeToWorkflow(task.task_type);
  // fire-and-forget: 启动 workflow，不 await（避免 tick 阻塞）
  runWorkflow(workflowName, task.id, task.attempt_n ?? 1, task).catch(logError);
}
```

### 6.5 验收

- `harness-initiative-runner.js` / `content-pipeline-graph-runner.js` 删除，逻辑移到 `workflows/`
- tick.js 瘦身到不超过 200 行，只负责选任务 + 启动 workflow
- Brain 崩溃重启：任一 workflow 自动从最后 checkpoint resume（带 2303a935 这个 E2E 验证）
- 新 pipeline 接入只需添加 `workflows/new-pipeline.graph.js` + task_router 映射

---

## 7. Observer 分离

### 7.1 当前问题

watchdog / shepherd / pipeline-patrol 目前嵌入 tick 调用链，它们做决策时会：
- 阻塞 tick（如 shepherd 调 Codex LLM 分析 quarantine）
- 凭**历史 DB 计数**判断状态（`repeated_failure` 在 task 历史上出现过就 quarantine），不管当前任务是否正在跑

2303a935 被连续 quarantine 就是这个问题 — shepherd 看到历史失败，无视它当下正在 harness 流水线中运行。

### 7.2 v2 设计

所有 observer 搬到 `packages/brain/src/observers/`，**只读 DB 当前状态**。

**关键修正**：不能只看"有没有 checkpoint 记录" — 一个崩了 4 小时前的 workflow 也有 checkpoint，但它不是活跃的。"活跃"必须用**近期心跳信号**判断：

```js
// observers/shepherd.js
const LIVENESS_WINDOW_MS = 90_000; // 90s 内无心跳视作不活跃

export async function shepherdLoop() {
  setInterval(async () => {
    const suspects = await pool.query(`
      SELECT t.id, t.status, t.retry_count, t.attempt_n
      FROM tasks t
      WHERE t.status IN ('queued', 'in_progress')
        AND t.retry_count >= 3
        AND NOT EXISTS (
          -- "活跃"信号 A：当前 attempt 的 checkpoint 最近写过
          SELECT 1 FROM checkpoints c
          WHERE c.thread_id = t.id || ':' || t.attempt_n
            AND c.created_at > NOW() - INTERVAL '90 seconds'
        )
        AND NOT EXISTS (
          -- "活跃"信号 B：有 cidfile 对应的 docker container 仍在 running
          SELECT 1 FROM running_containers rc
          WHERE rc.task_id = t.id AND rc.status = 'running'
        )
    `);
    for (const task of suspects.rows) {
      await quarantine(task.id, 'repeated_failure');
    }
  }, 60_000);
}
```

`running_containers` 视图可以由 docker-run middleware 写入/维护（cidfile → 容器 ID → `docker inspect` 状态）。或者更简单：保留 `tasks.heartbeat_at` 字段，每个 node 开始/结束时 orchestrator 自动 bump。

**Observer 独立**：所有 observer 走独立 `setInterval`，不和 tick 共享 event loop。**单独开一个 PG 连接池**（避免 observer 慢查询饿死 dispatch）。

### 7.3 验收

- 跑 harness E2E 时 shepherd 不再 quarantine 活跃 task
- tick_duration_ms 恒定 < 5s（不被 observer 阻塞）
- 83-min 自杀根因消失（tick 不嵌 observer 不 await 长任务）

---

## 8. 迁移路径（4 阶段）

**原则**：每阶段独立 ship，阶段间 Brain 一直 working。

### P1: Spec + 占位（1-2 天）

**产出**：
- 本文档（已完成）
- `docs/design/v2-scaffolds/spawn-readme.md`（API 骨架，P2 git mv 到 `packages/brain/src/spawn/README.md`）
- `docs/design/v2-scaffolds/workflows-readme.md`（graph 约定，P3 git mv 到 `packages/brain/src/workflows/README.md`）
- `docs/design/v2-scaffolds/observers-readme.md`（P4 git mv 到 `packages/brain/src/observers/README.md`）

**为什么放 `docs/design/v2-scaffolds/` 而不直接建 `packages/brain/src/{spawn,workflows,observers}/`**：P1 要纯 docs 才能不触发 Brain precheck（facts-check 绑 `packages/brain/` 路径）。P2/P3/P4 真正新建目录时 `git mv` 到位，零返工。

**不改任何代码**。只是给 P2-P4 作者立地图。

---

### P2: Spawn Policy Layer（1 周）

**核心交付**：`packages/brain/src/spawn/spawn.js` + 10 个 middleware。

**步骤**：
1. 抽 `docker-executor.js` 内部函数为 `spawn/docker-run.js`（单纯执行 docker run）
2. 依次实现 10 个 middleware（每个独立 PR，按依赖顺序）
3. 新 `spawn()` 组装 middleware 链
4. 迁移 `harness-*` / `content-pipeline-graph-runner` 调 `spawn()` 替代 `executeInDocker`
5. 删除 `executor.js` 里剩余 2 处硬编码 account1
6. 下线 `executeInDocker` 对外 export（内部用 `docker-run`）

**验收**：
- 所有 spawn 走统一 middleware
- 账号 / cap marking / billing 一次到位
- 新 harness E2E 从头到尾一个 account1 都不再出现（或只出现 "显式指定且 capped→fallback"）

---

### P3: Workflow Registry（2 周）

**执行纪律**：**P3 不用 harness，全程 `/dev` 手动推**。原因：P3 搬的代码就是 `harness-initiative-runner.js` / `harness-gan-graph.js` 自己——一边跑 harness 一边搬 harness 会产生 race condition，跑到一半代码被改名。

**核心交付**：`workflows/*.graph.js` + `orchestrator/graph-runtime.js` + tick 瘦身。

**步骤**：
1. 实现 `orchestrator/graph-runtime.js`（含 resume 逻辑）
2. 搬 `harness-initiative-runner.js` 逻辑 → `workflows/harness-initiative.graph.js`
3. 搬 `harness-gan-graph.js` → `workflows/harness-gan.graph.js`（合并重构）
4. 搬 `content-pipeline-graph.js` → `workflows/content-pipeline.graph.js`
5. `tick.js` 瘦身，调 `runWorkflow(name, threadId)`
6. 写 resume E2E 测试：spawn 一个 graph，中途 kill Brain，重启后验证 checkpoint 接着跑

**验收**：
- 跑 2303a935，中途 kill brain，重启后 Planner 不重跑（resume 从 Proposer-N 起）
- 新 pipeline 接入代码量 ≤ 100 行（仅 graph 文件）

---

### P4: Observer 分离（1 周）

**核心交付**：`observers/` 目录 + watchdog / shepherd / patrol 解耦。

**步骤**：
1. 抽 watchdog 逻辑到 `observers/watchdog.js`，独立 setInterval
2. 抽 shepherd 到 `observers/shepherd.js`，加"排除活跃 task"条件
3. 抽 pipeline-patrol 到 `observers/pipeline-patrol.js`
4. tick.js 删除所有 observer 调用
5. 写 stress 测试：模拟长 harness pipeline，tick 不应被阻塞 > 5s

**验收**：
- tick_duration_ms P99 < 5s
- harness pipeline 运行中 shepherd 不再误 quarantine
- Brain 83-min 自杀根因不再出现（观察 24h）

---

## 9. 风险与回滚

### 9.1 风险

| 风险 | 缓解 |
|---|---|
| P2 迁移期间 middleware 行为与旧 dispatchTask 不一致 → 生产任务失败 | 每个 middleware 独立 PR + 充分单测；feature flag `SPAWN_V2_ENABLED` 灰度（单个 env var 可即时切回） |
| P3 LangGraph resume 边界情况多（subgraph / interrupt / parallel node） | 先迁 `dev-task` 这种单 node graph 灰度稳 2 天，再迁 `harness-gan` / `content-pipeline` |
| Brain 重构期间 harness E2E 一直挂 | **不做双跑兼容**（长期技术债陷阱）。P3 合并即删老 runner；灰度靠 `WORKFLOW_RUNTIME=v1\|v2` + task_type 白名单 |
| P2/P3 递归问题（harness 自己跑在 Brain 里，用 harness 改 Brain） | P2 可用 harness（改 executor.js 不动 harness 本身）；**P3 禁用 harness，走 `/dev` 手动推**（P3 搬的就是 harness runner 自己） |

### 9.2 回滚策略

- **P2**：env var `SPAWN_V2_ENABLED=false`，立即回到旧 `dispatchTask` 路径。flag 上线至 P2 合并后 1 周观察稳定，之后**删除 flag + 删除老路径**（不保留"以防万一"）
- **P3**：env var `WORKFLOW_RUNTIME=v1|v2`，配合 task_type 白名单按 workflow 粒度切。灰度至所有 workflow 都切到 v2 + 观察 1 周 + 再删 flag 和老 runner
- **P4**：observer 独立 setInterval 是单向修改（observer 不再嵌 tick），不需要 flag。回滚等于把 observer loop import 回 tick，是 git revert 级别的操作

---

## 10. 参考对照

### 10.1 LangGraph

- **State is first-class**：workflow 的"数据"是个显式对象 ← 我们的 `channels`
- **Node = 纯函数**：`(state) => partial state` ← 我们的 graph node
- **Checkpointer 自动持久化**：每 node 存 Postgres ← 我们用 `PostgresSaver`
- **Conditional edges**：路由不是 if-else 散在代码里 ← 我们用 `addConditionalEdges`
- **Subgraph**：大 workflow 嵌小 workflow ← harness-gan 作为 harness-initiative 的 subgraph

LangGraph 是 Orchestrator 层的选型，不替换 Scheduler（tick）和 Executor（spawn）。

### 10.2 Temporal

- **分离**：workflow "orchestration" vs activity "execution" ← 对应我们的 Layer 2 vs Layer 1
- **Durability**：workflow 可崩溃重跑 ← 对应 LangGraph checkpointer

Temporal 生态重，本次不引入。但学它的分层思想。

### 10.3 Argo Workflows

- **DAG as CRD**：声明式 workflow ← 对应我们的 `.graph.js` 文件
- **Worker pool**：独立执行器 ← 对应 docker container

我们不搬 k8s，保持 Docker + spawn。但学"声明式优于过程式"。

---

## 11. 附录：当前代码地图（给执行者）

### 11.1 需要重点读的文件

- `packages/brain/src/executor.js:3030-3100` — 当前唯一的智能层（迁 P2 middleware）
- `packages/brain/src/docker-executor.js:343-520` — 当前 executeInDocker（拆为 spawn + middleware）
- `packages/brain/src/harness-initiative-runner.js` — 整搬到 workflows/harness-initiative.graph.js
- `packages/brain/src/harness-gan-graph.js` — 已是 LangGraph，重新 export 为 subgraph
- `packages/brain/src/content-pipeline-graph.js` + `content-pipeline-graph-runner.js` — 合并
- `packages/brain/src/account-usage.js` — 保持不变，供 middleware 引用
- `packages/brain/src/tick.js:753-840` — selectNextDispatchableTask 保留，tick 主体 line 2800+ 瘦身
- `packages/brain/src/routes/execution.js:798` — `markSpendingCap` 调用点，要搬到 middleware

### 11.2 当前硬编码位置清单（需要删）

```
✅ (PR #2534 已删 4 处) harness-initiative-runner.js:118
✅ (PR #2534 已删 4 处) harness-gan-graph.js:162
✅ (PR #2534 已删 4 处) harness-gan-graph.js:193
✅ (PR #2534 已删 4 处) harness-task-dispatch.js:45
❌ executor.js:2856  — LangGraph pipeline env
❌ executor.js:3045  — Sprint 硬绑 (此处有 fallback，P2 迁到 middleware 时留显式 override 路径)
❌ content-pipeline-graph-runner.js:70 — DEFAULT_CREDENTIAL（PR #2533 加了 selectBestAccount fallback，但仍以 'account1' 兜底）
```

### 11.3 测试基线

- `packages/brain/src/__tests__/docker-executor-account-rotation.test.js` — PR #2534 新加的 middleware 测试，P2 扩展到全 middleware 链
- `packages/brain/src/__tests__/harness-gan-graph.test.js` — 现有 graph 测试，P3 迁移时复用
- `packages/brain/src/__tests__/select-next-claimed-filter.test.js` — dispatchable task SQL 测试，P3 tick 瘦身时保留

### 11.4 数据库表（v2 不动 schema）

- `tasks` — 任务状态（orchestrator 写 in_progress/completed）
- `checkpoints` + `checkpoint_blobs` + `checkpoint_writes` — LangGraph checkpointer（保持）
- `account_usage_cache` — spending_cap 持久化（P2 cap-marking middleware 写）
- `initiative_contracts` / `initiative_runs` — harness 专用（P3 graph 写）

---

## 12. 评审决策（已定 — 2026-04-22）

### 12.1 §12 原 5 问

| # | 问题 | 决策 | 理由 |
|---|---|---|---|
| 1 | v2 范围 | **只改 Brain 内部**，不抽 `packages/spawn/` 子包 | spawn API 稳定至少 1 个季度后再考虑抽包。现在抽等于把内部 API 过早锁死 |
| 2 | LangGraph 版本 | **不升级**，保持当前 `@langchain/langgraph` 版本 | 重构 + 依赖升级同时干 = bug 双倍难定位。v2 稳定后单独 bump |
| 3 | 回滚 flag | **P2 和 P3 都加，P4 不加** | P2 `SPAWN_V2_ENABLED` + P3 `WORKFLOW_RUNTIME=v1\|v2`；P4 是旁路改造，revert 即可 |
| 4 | workflow 命名 | **`.graph.js`** | 对齐 LangGraph 生态 |
| 5 | observer 独立进程 vs setInterval | **setInterval 先行**，独立 PG 连接池 | 压力大了再拆进程。独立连接池避免慢查询饿死 dispatch |

### 12.2 补充决策（来自评审）

| # | 问题 | 决策 |
|---|---|---|
| 6 | Middleware 结构 | **两层洋葱**：外层 Koa 风格 + 内层 attempt-loop（rotation × cascade × 429）。见 §5.2 |
| 7 | cascade × rotation 遍历顺序 | **先横切账号保持 Sonnet**，全满再降 Opus / Haiku。质量优先。见 §5.3 |
| 8 | thread_id 语义 | **`task.id + ':' + attempt_n`**，retry 递增 attempt_n 开新 thread，不复用老 checkpoint。见 §6.3 |
| 9 | Layer 编号方向 | **L1 Scheduler（顶）→ L2 Orchestrator → L3 Executor（底）**，符合"L1 是入口"直觉 |
| 10 | P3 是否用 harness | **禁用**，走 `/dev` 手动推（避免 harness 自改 harness 的 race condition）。见 §8 P3 |
| 11 | P3 双跑兼容 | **不做**。P3 合并即删老 runner，灰度靠 `WORKFLOW_RUNTIME` flag + task_type 白名单 |

### 12.3 下一步

- P1：`/dev` 写三个 README 骨架（不值得 harness）
- P2：Harness Initiative，按 §5.2 两层结构 × 10 个 PR
- P3：`/dev` 手动推，按 §6 搬 workflow，遵守"先单 node graph 再复杂的"节奏
- P4：Harness Initiative，按 §7 拆 observer

spec 冻结，进入执行阶段。
