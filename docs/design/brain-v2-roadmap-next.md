# Brain Orchestrator v2 — 接力 PRD（2026-04-23 起草）

> **谁该读这份文档**：新会话接手 Brain v2 架构剩余工作的人（Claude 或 Alex）。
> **状态**：P2 Layer 3（Executor）已完成 ✅。剩余 Phase A-E 待做。

---

## 0. 冷启动三步

新会话进来先做这三件事，不要跳过：

### Step 1：读 3 份 source-of-truth 文档

```bash
cat docs/design/brain-orchestrator-v2.md                      # 原 spec（§1-12）
cat ~/.claude-account3/projects/-Users-administrator-perfect21-cecelia/memory/brain-orchestrator-v2.md  # 进度快照
cat docs/design/brain-v2-roadmap-next.md                      # 本文档
```

### Step 2：查当前 main HEAD 状态

```bash
git log --oneline main -20 | grep -E "v2 P2|spawn|middleware" | head -15
ls packages/brain/src/spawn/
ls packages/brain/src/spawn/middleware/
```

期望看到 14 个已合 PR（#2538-#2557）+ spawn/ 目录 + 9 个 middleware 文件 + 对应 __tests__/。

### Step 3：选 Phase

看本文档 §2 "Phase 清单"，挑一个 Phase 开始。**禁止跨 Phase 混做**——每个 Phase 是独立里程碑。

---

## 1. 当前已落地（P2 done）

| 层 | 状态 |
|---|---|
| L3 Executor (Spawn Policy Layer) | ✅ 完成 — 9 middleware + executeInDocker 接线 |
| L2 Orchestrator (Workflow Registry) | ❌ 未起 |
| L1 Scheduler (tick 瘦身) | ❌ 未起 |
| Observer 分离（横切，非 Layer） | ❌ task 注册但 paused |
| attempt-loop 真循环（L3 内部收尾） | ❌ 未起 |

### L3 当前 hot path（已激活）

```
executeInDocker(opts):
  logger.logStart()                                 # PR #2557
  await checkCostCap(opts)                          # PR #2557 — deps 未注入时 no-op
  writePromptFile + resolveCascade + resolveAccount # PR #2543/#2545/#2546
  buildDockerArgs + cidfile 清理
  result = await runDocker(args, {...})             # PR #2544
  await checkCap(result, opts)                      # PR #2557 — 429 检测
  await recordBilling(result, opts)                 # PR #2557 — deps 未注入时 no-op
  logger.logEnd(result)                             # PR #2557
  return result
```

### 9 middleware 文件清单（全在 `packages/brain/src/spawn/middleware/`）

- **内层 attempt-loop 5 个**：`account-rotation.js` / `cascade.js` / `resource-tier.js` / `docker-run.js` / `cap-marking.js`
- **内层独立 1 个**：`retry-circuit.js`（classifyFailure + shouldRetry）
- **外层 Koa 4 个**：`cost-cap.js` / `spawn-pre.js` / `logging.js` / `billing.js`

---

## 2. Phase 清单（按建议优先级）

| Phase | 内容 | PR 估计 | 工作量 | 可 harness? | 先决条件 |
|---|---|---|---|---|---|
| **A** | attempt-loop 真循环（cascade × rotation retry）| 1-2 | 4-6h | ❌ 手动 /dev | L3 wire 已完成 ✅ |
| **B** | Brain 健康修复（thalamus credits + shepherd）| 2-3 | 2-4h | ❌ 手动 /dev | 无 |
| **C** | L2 Orchestrator / P3 Workflow Registry | 5-7 | 2 周 | ❌ 手动 /dev（spec 明禁）| B 完成后最顺 |
| **D** | L1 Scheduler / tick 瘦身 | 2-3 | 1 周 | ❌ | C 完成后 |
| **E** | P4 Observer 分离（已 queued task `15e9542d`）| 3-4 | 1 周 | ✅ 可 harness | B 完成（harness 要能 dispatch）|

**推荐路径**：A → B → E（并行）→ C → D

**理由**：A 是 L3 自然收尾；B 修好后 E 可以扔给 Brain 自己跑；C 才是大块头，要最清醒的 context；D 跟 C 合并或紧跟。

---

## Phase A：attempt-loop 真循环 PRD

### Goal

把 executeInDocker 改成真正的 `for (account × model) in cascade × rotation` 循环。失败时自动下一候选，permanent 失败不重试，超过 maxAttempts 返回最后结果。

### 现状

当前 executeInDocker 是"一次 spawn 一次 attempt"。spec §5.2 要求真 for 循环。`retry-circuit.js` 和 `classifyFailure` 已建，未被调用。

### 目标改动（单 PR）

**改 1 个文件**：`packages/brain/src/spawn/spawn.js` 或 `packages/brain/src/docker-executor.js`（选择见下）

**两个设计选择**：

**选项 A1（推荐）**：attempt-loop 在 `spawn.js` 外层，executeInDocker 保持"一次 attempt 的语义"

```js
// spawn.js
import { classifyFailure, shouldRetry } from './middleware/retry-circuit.js';
import { executeInDocker } from '../docker-executor.js';
import { checkCap } from './middleware/cap-marking.js';

const MAX_ATTEMPTS = 3;

export async function spawn(opts) {
  // 外层 middleware 在 executeInDocker 里已接（PR #2557），这里只做 attempt-loop
  let lastResult = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const result = await executeInDocker(opts);
    lastResult = result;
    const cls = classifyFailure(result);
    if (cls.class === 'success') return result;
    if (cls.class === 'permanent') return result;
    // transient: check if we should retry
    if (!shouldRetry(cls, attempt, MAX_ATTEMPTS)) return result;
    // cap-marking 已在 executeInDocker 末尾跑过，account-rotation 下一次调时自动换号
    console.log(`[spawn] attempt ${attempt + 1} transient failure (${cls.reason}), retrying`);
    // 清 opts.env.CECELIA_CREDENTIALS 让 account-rotation 重新选
    delete opts.env?.CECELIA_CREDENTIALS;
  }
  return lastResult;
}
```

**选项 A2**：attempt-loop 在 executeInDocker 里做。缺点是 executeInDocker 变复杂，spawn.js 又退化成 wrapper。不推荐。

### 采用 A1 的具体 Tasks

- **Task 1**：改 `spawn.js` 实现上面的循环（~30 行新增）
- **Task 2**：改 `spawn.test.js` 从 3 cases 扩到 7 cases：
  - success first try（当前已有）
  - transient → retry → success
  - transient × 3 attempts → give up
  - permanent → no retry
  - cap-marking 触发后下次 attempt 自动换号（需 vi.mock executeInDocker 链）
- **Task 3**：验证现有 caller（`harness-initiative-runner.js`）行为不退化（`spawn` 依然透传单次 opts）

### DoD

- [ ] `spawn.js` 导出 `spawn` 且含 for 循环
- [ ] `spawn.test.js` ≥ 7 cases，全 pass
- [ ] `grep -c 'for (let attempt' packages/brain/src/spawn/spawn.js` = 1
- [ ] facts-check 通过
- [ ] 现有其它测试不退化（docker-executor-account-rotation.test.js 等）

### 风险

- **retry 过于激进**：MAX_ATTEMPTS = 3 可能叠加现有 dispatch-level retry 变 9 次。验证：全仓 grep `failure_count` / `retry_count` 设计，确认 spawn 层 retry 不冲突
- **permanent 漏判**：`classifyFailure` 是启发式，Alex 的业务里可能有新 permanent pattern（比如 skill 不存在）。监控生产 spawn 日志 24h，补 regex
- **delete opts.env.CECELIA_CREDENTIALS 副作用**：caller 如果在循环内检查 opts.env 会看到被清过的版本。留注释说明

### 完工命令

```bash
# 验证 attempt-loop 真运行
node -e "const c=require('fs').readFileSync('packages/brain/src/spawn/spawn.js','utf8'); if(!c.includes('for (let attempt')) process.exit(1)"
npx vitest run packages/brain/src/spawn/__tests__/spawn.test.js
```

---

## Phase B：Brain 健康修复 PRD

### Goal

让 Brain dispatch 机制重新工作。当前根因（2026-04-23 诊断）：
1. thalamus LLM API 欠费 → `credit balance is too low` 错误
2. Brain 8 小时内 restart 10+ 次（RestartCount=10）
3. shepherd 误 quarantine 活跃任务（2303a935 case）
4. 62 个任务在 queue 积压 0 个 in_progress

### Phase B 细分（3 小 PR）

#### B1：查 thalamus 配置 + 修 API credit

- 查 `packages/brain/src/thalamus.js` 的 LLM 调用配置
- 确认用的是 anthropic-api（付费）还是 anthropic OAuth（订阅）
- 如果是付费 key，充值
- 如果是 OAuth，换个没欠费的账号

**DoD**：`curl localhost:5221/api/brain/test/thalamus-llm` 返回 200 + 实际 LLM 响应

#### B2：shepherd 误判修复

- 看 `packages/brain/src/shepherd.js`（或 tick 里的 shepherd 逻辑）
- 现状：看 `retry_count >= 3` 就 quarantine
- 改法：加 "活跃信号" 判断（spec §7.2）：
  ```sql
  NOT EXISTS (checkpoint 最近 90s 有 write OR cidfile 对应 container running)
  ```
- 加单测：2303a935 案例（retry_count=3 但 checkpoint 最近写 → 不 quarantine）

**DoD**：注册 3 次失败 + 检查活跃状态不被 quarantine 的 E2E test

#### B3：Brain restart 循环诊断

- 看 `gracefulShutdown` 日志（PR #2541 已加）
- 看 docker `RestartCount` 原因：OOM / exit 0 / exit != 0
- 根据日志分类：thalamus 异常→修 key / tick 死锁→加超时 / 内存峰值→调 container limit

**DoD**：Brain 连续 run 1h 不重启

### 风险

- **thalamus key 欠费是个人账户问题**，不是代码。需要 Alex 决定充值或换
- **shepherd 改动可能误放 真死任务**：加 metric 追踪 quarantine 绕过率，异常报警

---

## Phase C：L2 Orchestrator / P3 Workflow Registry PRD

### Goal

实现 spec §6：把 `harness-initiative-runner.js` / `harness-gan-graph.js` / `content-pipeline-graph.js` 统一到 `packages/brain/src/workflows/` 目录，每个 workflow 一个 `.graph.js` 文件，运行时 `graph-runtime.js` 负责 checkpoint/resume。

### 纪律（spec §8 P3 明文）

- **禁用 harness 自动跑**（harness 自己就是要搬的代码，race condition）
- **全程手动 /dev 推**，每个 graph 迁移一个 PR
- **feature flag**：`WORKFLOW_RUNTIME=v1|v2`，task_type 粒度灰度
- **合并即删老 runner**，不做长期双跑兼容

### Tasks（~5-7 PR 序列）

#### C1：`orchestrator/graph-runtime.js` 骨架（1 PR）

```js
// packages/brain/src/orchestrator/graph-runtime.js
export async function runWorkflow(workflowName, taskId, attemptN, input = null) {
  const graph = getWorkflow(workflowName);
  const threadId = `${taskId}:${attemptN}`;
  const config = { configurable: { thread_id: threadId } };
  const hasCheckpoint = await checkpointerHasThread(threadId);
  const actualInput = hasCheckpoint ? null : input;
  return await graph.invoke(actualInput, config);
}
```

加 thread_id 格式强制（spec §6.3 `{task.id}:{attempt_n}`）。

#### C2：dev-task.graph.js 单 node graph（1 PR）

最简 workflow，用来验证 graph-runtime 能工作。task_type=dev 的任务走这条。

#### C3：harness-gan.graph.js（1 PR）

从 `harness-gan-graph.js` 搬家到 `workflows/harness-gan.graph.js`，作为 subgraph。

#### C4：harness-initiative.graph.js（1 PR）

从 `harness-initiative-runner.js` 搬家，组合 harness-gan 作为 subgraph。

#### C5：content-pipeline.graph.js（1 PR）

从 `content-pipeline-graph.js` 搬家。

#### C6：tick 瘦身（Phase D 的内容，可合进 C6 或单独 PR）

tick.js 不再调 specific runners，只调 `runWorkflow(workflowName, taskId, attemptN, task)`。

#### C7：清老 runner（1 PR）

合并 C2-C5 后，删 `harness-initiative-runner.js` / `harness-gan-graph.js` / `content-pipeline-graph-runner.js`。

### DoD（整体）

- [ ] `packages/brain/src/workflows/` 含 5+ graph 文件 + index.js
- [ ] `packages/brain/src/orchestrator/graph-runtime.js` 存在
- [ ] `runWorkflow('harness-initiative', taskId, 1, input)` 跑完一个完整 harness pipeline
- [ ] **崩溃重启 resume 验证**（spec §6.5）：跑一个 workflow 中途 kill Brain，重启后自动从 checkpoint 继续
- [ ] 老 runner 文件已删

### 风险

- **LangGraph checkpointer pg schema**：`checkpoints / checkpoint_blobs / checkpoint_writes` 三张表要存在。查 `packages/brain/migrations/` 是否已有（估计有）
- **thread_id 冲突**：如果 `taskId` 有现有 workflow 残留 checkpoint，attempt_n=1 直接用，可能接到脏状态。清仓策略：migration 里 truncate checkpoints 表（一次性）
- **harness E2E 中断**：切流量时某个 task 一半在 v1 一半在 v2 → 数据结构不兼容。用 task_type 白名单渐进切

---

## Phase D：L1 Scheduler / tick 瘦身 PRD

### Goal

tick.js 从当前 3000+ 行瘦到 ≤ 200 行。去掉所有 workflow-specific 调用，只做：

1. 读 dispatchable task
2. 路由到 workflowName
3. fire-and-forget 调 `runWorkflow(...).catch(logError)`

### 现状

看 tick.js L753-840 `selectNextDispatchableTask` 保留，其它删。

### Tasks（1-2 PR）

#### D1：tick 核心瘦身

```js
async function tick() {
  const task = await selectNextDispatchableTask(...);
  if (!task) return;
  const workflowName = taskTypeToWorkflow(task.task_type);
  runWorkflow(workflowName, task.id, task.attempt_n ?? 1, task).catch(logError);
}
```

#### D2：删老 dispatch 代码

executor.js:dispatchTask 内部的 LangGraph pipeline 分支等老代码全删。

### DoD

- [ ] tick.js ≤ 200 行
- [ ] tick_duration_ms P99 < 5s（加 CI benchmark）
- [ ] 所有 task_type 都有对应 workflow

### 风险

- **tick 改动涉及调度核心**：必测 12 种 task_type 全走通
- **某些 task_type 没对应 graph**：需要 catch-all workflow（默认 dev-task.graph.js）

---

## Phase E：P4 Observer 分离 PRD

### Goal

把 watchdog / shepherd / pipeline-patrol / cost-tracker / analytics 从 tick 嵌入里剥出来，独立 setInterval，只读 DB 状态。

### 现状

- Brain task `15e9542d-8b42-4cb3-bf32-b3a1736febc0`（harness_initiative P2）已登记但**paused**
- Phase B 完成后，unquarantine + 让 Brain tick 自己 dispatch

### 交付物（spec §7）

在 `packages/brain/src/observers/` 下建立：

```
observers/
├── watchdog.js           — tick 健康检查
├── shepherd.js           — 卡死任务 quarantine（加活跃信号，spec §7.2）
├── pipeline-patrol.js    — 横向巡航
├── cost-tracker.js       — 账号预算
├── analytics.js          — metric 上报
└── pg-pool.js            — 独立 PG 连接池
```

### 关键规矩（spec §7.3 硬规矩）

- **Observer 只读**：不调 `executor.dispatchTask` / `spawn()` / `runWorkflow`
- **独立 event loop**：setInterval，不挂 tick
- **独立 PG 连接池**：避免慢查询饿死 dispatch
- **阻塞不超 5s**：statement_timeout 兜底

### DoD

- [ ] tick_duration_ms P99 < 5s（stress test 下）
- [ ] shepherd 不再误 quarantine 活跃 task（2303a935 manual replay）
- [ ] Brain 83-min 自杀不再（24h 观察）

### 是否可 harness

✅ **可**。Phase E 是旁路改造，不动 harness runner 本身。Phase B 修好 Brain dispatch 后，把 task `15e9542d` unpause + dispatch，harness planner 自己拆 5 tasks 走完。

---

## 3. 全局注意事项

### 禁忌（每个 Phase 通用）

- ❌ 不允许 `git push origin main`
- ❌ 不允许在 main 分支直接改代码（docs 除外）
- ❌ 不允许 `gh pr merge --admin`（除非 CI 全绿 + mergeable）
- ❌ 不允许跳过 /dev 流程（cp-* 分支 + PR + CI）
- ❌ 不允许用 harness 做 Phase C（spec 明禁）

### 每个 Phase 启动前的自检

1. 读完本文档对应 Phase 小节
2. `git log --oneline main -5` 确认 HEAD 位置
3. Brain 健康（`curl localhost:5221/api/brain/context` 有 active_tasks in_progress > 0）
4. 如果 Brain 不健康但 Phase 要 harness → 先做 Phase B

### 失败恢复

- 如果 /dev 推 PR CI 挂 2 次无法修 → BLOCKED，写回 Brain 让下个会话 review
- 如果 harness 跑飞 → Dashboard 暂停 task，不强制恢复
- 如果 context 超 → 立即停下写 handoff doc，新会话接力

### Memory 维护

每个 Phase 合并后：

```bash
# 更新 memory
vim ~/.claude-account3/projects/-Users-administrator-perfect21-cecelia/memory/brain-orchestrator-v2.md
# "进度" 节加 Phase X 完成标记

# 更新 changelog
vim ~/.claude-account3/projects/-Users-administrator-perfect21-cecelia/memory/changelog.md
# "2026-04-XX" 节追加 Phase X PR 列表
```

---

## 4. 参考资料速查

- **原 spec**：`docs/design/brain-orchestrator-v2.md`（641 行 + 11 决策表）
- **P1 scaffolds**（架构图）：`docs/design/v2-scaffolds/{spawn,workflows,observers}-readme.md`
- **Memory 主索引**：`~/.claude-account3/projects/-Users-administrator-perfect21-cecelia/memory/MEMORY.md`
- **Memory v2 进度**：`~/.claude-account3/projects/-Users-administrator-perfect21-cecelia/memory/brain-orchestrator-v2.md`
- **/dev autonomous 规则**：`~/.claude-account3/skills/dev/SKILL.md`
- **Brain API 速查**（放入 CLAUDE.md §7）：`curl localhost:5221/api/brain/context` / `/api/brain/tasks`

---

## 5. 本轮 PR 清单（#2538-#2557，14 个）

供新会话 diff review 时对照：

```
#2538  docs: Brain v2 spec + P1 scaffolds
#2540  fix(brain): selfcheck EXPECTED_SCHEMA_VERSION 241→243
#2543  feat(brain): v2 P2 PR1 spawn() skeleton + harness-initiative-runner 迁移
#2544  refactor(brain): v2 P2 PR2 docker-run middleware 抽出
#2545  refactor(brain): v2 P2 PR3 account-rotation middleware 抽出
#2546  feat(brain): v2 P2 PR4 cascade middleware
#2548  feat(brain): v2 P2 PR5 cap-marking middleware
#2550  feat(brain): v2 P2 PR6 retry-circuit middleware
#2551  refactor(brain): v2 P2 PR7 resource-tier middleware 抽出
#2552  feat(brain): v2 P2 PR8 外层 spawn-pre + logging middleware
#2553  feat(brain): v2 P2 PR9 外层 cost-cap + billing middleware
#2554  fix(brain): v2 P2 PR10 清 content-pipeline 硬编码 account1
#2555  refactor(brain): v2 P2 PR11 清 SPAWN_V2_ENABLED flag
#2557  feat(brain): v2 P2.5 外层 middleware 接线到 executeInDocker
```

---

**本 PRD 冻结**：2026-04-23。新会话开工前如果想加/改方向，在 §2 Phase 清单上追加新 Phase，不要改已有 Phase 内容（避免新老会话理解错位）。

Alex 可以在本文档顶部追加"方向"章节（比如 §0.5：Alex 的大方向调整），新会话优先读那一节。
