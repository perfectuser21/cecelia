# Harness LangGraph 可靠性 + 运维打通 Spec

**日期**: 2026-05-06（上海时间）
**触发事件**: MJ1 walking skeleton initiative 任务 `b10de974-85ca-40ab-91d6-2965f0824c9d` stuck at step 75，暴露一连串预先存在的可靠性 + 运维 bug
**目标**: 用 LangGraph 1.2.9 已有但未启用的可靠性原语 + 修 docker-executor 边界 bug + 清理运维清单，让 Brain 派 harness initiative 任务能**每次跑通交付，全程无人干预**
**Initiative scope**: 5 LangGraph 原语 + 1 docker bug + 6 运维项 + 1 端到端 acceptance run
**License 前提**: `@langchain/langgraph` 1.2.9 是 MIT，无任何商用/转售限制

---

## 1. 背景与诊断

### 1.1 MJ1 stuck 的真根因（推断 + 待验证）

`packages/brain/src/executor.js:2826` 永远用固定 thread_id 调用 graph：

```js
const final = await compiled.invoke(
  { task },
  { configurable: { thread_id: `harness-initiative:${initiativeId}:1` }, recursionLimit: 500 }
);
```

LangGraph 规则：**只要 thread_id 已有 checkpoint，新传 input 被忽略，从最后 checkpoint 继续**。结果链条：

1. 子 task `evaluate` node 调 docker-executor
2. Docker container OOM（exit=137，PR #2805 在修）
3. docker-executor 在边界条件下没正确 reject Promise（待验证）
4. invoke() chain 永远 hang
5. Brain 重启 → 重新 dispatch → 同 thread_id → 从 stuck checkpoint 续跑 → 再 stuck → 死循环
6. 用户手撕 SQL `DELETE FROM checkpoints WHERE thread_id LIKE '%b10de974%'` 才解开

### 1.2 已经用对的部分（LangGraph 现状 80%）

| 能力 | 用了 | 位置 |
|---|---|---|
| StateGraph + Annotation.Root 类型化 | ✓ | `harness-initiative.graph.js:520-560` |
| PostgresSaver checkpointer | ✓ | `orchestrator/pg-checkpointer.js`（单例）|
| recursionLimit | ✓ 外 500 / 子 200 | `executor.js:2828` + `graph.js:906` |
| Send API 并行 fan-out | ✓ | `fanoutSubTasksNode` |
| Docker 执行 LLM agent（cgroup + --rm）| ✓ | `docker-executor.js`（每节点内调用）|
| 双层 graph（initiative + sub-task）| ✓ | full graph 14 节点 |

### 1.3 缺漏的 5 件 LangGraph 原语 + 1 件 docker bug

| # | 缺什么 | 后果 |
|---|---|---|
| **W1** | thread_id 没版本化（永远 `:1`）| Brain 重启续 stuck checkpoint，无法 fresh start |
| **W2** | 节点级 retryPolicy 全空 | 瞬时错误 → 整 initiative 失败 |
| **W3** | invoke() 无 AbortSignal / 无 watchdog 读 deadline_at | 跑 6h 没人能 kill |
| **W4** | invoke() 阻塞，不用 stream | LiveMonitor 看不到节点级进度 |
| **W5** | 无 interrupt() 关键决策点 | 401 / PRD 模糊 / E2E 红 silent END，主理人不知 |
| **W6** | docker-executor OOM/SIGKILL Promise 不 reject | invoke() hang（W1 复活的 root cause）|

### 1.4 与 LangGraph 库的关系（用户多次确认）

- **不重写引擎**：LangGraph MIT 开源，不是核心 IP，无 license 风险
- **不上 LangGraph Platform**：跨进程编排今天用不上，单 Brain 进程 + Docker 子进程满足需求
- **只做的事**：把库已有但未启用的 API 用上，配合修自己的边界 bug

---

## 2. 解决方案 — 7 个 Work Stream

每个 Work Stream 设计为独立 PR + 独立 agent 可承接。改动面 + LangGraph API + DoD 对每个 stream 自包含。

### Work Stream 1: thread_id 版本化（resume vs fresh 由 caller 决定）

**目标**: caller 通过 `attemptN` 显式控制 fresh start vs resume，杜绝"无脑续 stuck checkpoint"。

**改动文件**:
- `packages/brain/src/executor.js:2820-2847`（harness_initiative 路由分支）
- `packages/brain/src/orchestrator/graph-runtime.js`（已有正确 pattern，复用即可）

**API 用法**:

```js
// 替换 executor.js:2820-2847：
if (task.task_type === 'harness_initiative') {
  const { compileHarnessFullGraph } = await import('./workflows/harness-initiative.graph.js');
  const compiled = await compileHarnessFullGraph();
  const initiativeId = task.payload?.initiative_id || task.id;

  // attemptN：默认 1（首次）；fix_round / retry_count 触发 +1
  const attemptN = (task.execution_attempts || 0) + 1;
  const threadId = `harness-initiative:${initiativeId}:${attemptN}`;

  // resume 检测：只有显式 payload.resume_from_checkpoint=true 才续
  const resumeRequested = task.payload?.resume_from_checkpoint === true;
  const checkpointer = await getPgCheckpointer();
  const existing = await checkpointer.get({ configurable: { thread_id: threadId } });

  let input;
  if (existing && resumeRequested) {
    input = null;  // resume from checkpoint
  } else {
    if (existing && !resumeRequested) {
      // 同 attemptN 已有 checkpoint 但未 resume → 升 attemptN（保留旧 checkpoint 留作诊断）
      const newAttemptN = attemptN + 1;
      const newThreadId = `harness-initiative:${initiativeId}:${newAttemptN}`;
      // bump task.execution_attempts 后用 newThreadId
    }
    input = { task };
  }

  const final = await compiled.invoke(input, { configurable: { thread_id: threadId }, ... });
}
```

**DoD**:
- [BEHAVIOR] `tests/integration/harness-thread-id-versioning.test.ts` — 模拟"已有 checkpoint + resume_from_checkpoint=false" → 自动升 attemptN，新 thread_id 跑 fresh
- [ARTIFACT] `executor.js` 改动通过 unit test
- 文档：在 `LANGGRAPH-INTERNALS.md` 第一条记录 thread_id 版本化规则

**PR 标题**: `feat(brain): harness graph thread_id 版本化 — fresh vs resume 显式可控`

**依赖**: 无（独立改动）

---

### Work Stream 2: 节点级 RetryPolicy

**目标**: 每个 node（尤其调 LLM/Docker 的）配 retryPolicy，瞬时错误自动重试，不再因为一次 timeout 整个 initiative 失败。

**改动文件**:
- `packages/brain/src/workflows/harness-initiative.graph.js`（14 个 addNode 调用）
- `packages/brain/src/workflows/harness-task.graph.js`（子图 node）
- `packages/brain/src/workflows/harness-gan.graph.js`（GAN 循环）

**API 用法**:

```js
// 给 LLM/Docker 调用类节点配 retryPolicy
const LLM_RETRY = {
  maxAttempts: 3,
  initialInterval: 5_000,
  backoffFactor: 2.0,
  jitter: true,
  retryOn: (err) => {
    // 区分瞬时（503/timeout/network）vs 永久（schema invalid/auth fail）
    const msg = String(err?.message || '');
    if (/401|403|invalid|schema|parse/i.test(msg)) return false;  // 永久错，不重试
    return true;
  },
};

return new StateGraph(FullInitiativeState)
  .addNode('planner', runPlannerNode, { retryPolicy: LLM_RETRY })
  .addNode('ganLoop', runGanLoopNode, { retryPolicy: LLM_RETRY })
  .addNode('run_sub_task', runSubTaskNode, { retryPolicy: LLM_RETRY })
  .addNode('evaluate', evaluateSubTaskNode, { retryPolicy: LLM_RETRY })
  .addNode('final_evaluate', finalEvaluateDispatchNode, { retryPolicy: LLM_RETRY })
  // 纯 DB / 状态机 节点不重试或更宽松：
  .addNode('parsePrd', parsePrdNode, { retryPolicy: { maxAttempts: 1 } })  // schema parse 失败重试无意义
  .addNode('dbUpsert', dbUpsertNode, { retryPolicy: { maxAttempts: 2, initialInterval: 1000 } })
  // ...
```

**DoD**:
- [BEHAVIOR] `tests/integration/harness-retry-policy.test.ts` — mock 一个 node 抛瞬时错误，验证自动重试 3 次后成功
- [BEHAVIOR] mock 永久错误（401），验证 retryOn=false，不重试直接 END
- [ARTIFACT] `LANGGRAPH-INTERNALS.md` 加"哪些 node 用 LLM_RETRY、哪些不"决策表

**PR 标题**: `feat(brain): harness graph 全节点 RetryPolicy — 区分瞬时/永久错误`

**依赖**: 无（独立改动；与 W1 互不冲突）

---

### Work Stream 3: AbortSignal + Watchdog 读 deadline_at

**目标**: invoke() 跑超过 `initiative_runs.deadline_at` 自动 abort。Brain 进程级 watchdog 周期检查所有跑中的 graph，逾期 SIGKILL。

**改动文件**:
- `packages/brain/src/executor.js`（invoke 调用处加 signal）
- `packages/brain/src/harness-watchdog.js` ← **新文件**（watchdog 实现）
- `packages/brain/src/tick.js`（注册 watchdog 5min/次）

**API 用法**:

```js
// executor.js
const initiativeRow = await dbPool.query(
  'SELECT deadline_at FROM initiative_runs WHERE initiative_id=$1 ORDER BY created_at DESC LIMIT 1',
  [initiativeId]
);
const deadline = initiativeRow.rows[0]?.deadline_at;
const ctrl = new AbortController();
const deadlineMs = deadline ? Math.max(0, new Date(deadline).getTime() - Date.now()) : 6 * 3600 * 1000;
const watchdogTimer = setTimeout(() => ctrl.abort(new Error(`harness graph watchdog: deadline exceeded`)), deadlineMs);

try {
  const final = await compiled.invoke(input, {
    configurable: { thread_id: threadId },
    recursionLimit: 500,
    signal: ctrl.signal,
  });
} catch (err) {
  if (err.name === 'AbortError') {
    // 写 task.failure_class='watchdog_deadline'，留 checkpoint 供诊断
  }
  throw err;
} finally {
  clearTimeout(watchdogTimer);
}
```

**Watchdog 5min/次扫描**（兜底，防止 Brain 重启丢 timer）:

```js
// harness-watchdog.js
export async function scanStuckHarness() {
  const overdueRuns = await pool.query(`
    SELECT initiative_id, deadline_at FROM initiative_runs
    WHERE phase IN ('A_planning', 'B_task_loop', 'C_final_e2e')
      AND deadline_at < NOW()
      AND completed_at IS NULL
  `);
  for (const r of overdueRuns.rows) {
    // 1. 标 phase='failed', failure_reason='watchdog_overdue'
    // 2. 写 alert（Feishu / DB）
    // 3. 不删 checkpoint（留诊断）
  }
}
```

**DoD**:
- [BEHAVIOR] `tests/integration/harness-watchdog.test.ts` — invoke 一个永远 sleep 的 mock node，AbortSignal 在 5s 后触发，invoke 抛 AbortError，task 标 watchdog_deadline
- [BEHAVIOR] `tests/integration/harness-watchdog-tick.test.ts` — 模拟 initiative_runs.deadline_at 已过，scanStuckHarness 标 phase=failed
- [ARTIFACT] tick.js 注册 watchdog 调用

**PR 标题**: `feat(brain): harness graph AbortSignal + watchdog — 逾期自动 kill`

**依赖**: 与 W1 不冲突；与 W2 不冲突（signal 跟 retryPolicy 互补，AbortError 不会被 retryOn 覆盖）

---

### Work Stream 4: streamMode='updates' 推事件到 LiveMonitor

**目标**: 把 `compiled.invoke()` 改成 `compiled.stream({ streamMode: 'updates' })`，每个 node 完成推一条事件到 `task_events` 表 → LiveMonitor 实时看节点进度。

**改动文件**:
- `packages/brain/src/executor.js`（invoke → stream 改造）
- `packages/brain/src/events/taskEvents.js`（新增 `emitGraphNodeUpdate`）
- `apps/dashboard/src/pages/LiveMonitor.tsx`（消费新事件类型）

**API 用法**:

```js
// executor.js
const stream = await compiled.stream(input, {
  configurable: { thread_id: threadId },
  recursionLimit: 500,
  signal: ctrl.signal,
  streamMode: 'updates',  // 每节点完成推一次
});

let final = null;
for await (const update of stream) {
  // update 形如 { nodeName: { partialState... } }
  for (const [nodeName, partialState] of Object.entries(update)) {
    await emitGraphNodeUpdate({
      taskId: task.id,
      initiativeId,
      threadId,
      nodeName,
      payloadSummary: summarize(partialState),  // 截取 < 500 字符防爆
      timestamp: new Date(),
    });
  }
  final = update;  // 最后一次 update 即终态
}
```

**DoD**:
- [BEHAVIOR] `tests/integration/harness-stream-events.test.ts` — mock graph 跑 5 个 node，验证 5 条 task_events 行被写入
- [ARTIFACT] LiveMonitor.tsx 显示节点级进度条（"prep ✓ → planner ✓ → parsePrd → ..."）
- [ARTIFACT] 性能：单 initiative 写 < 50 条 task_events（防写爆）

**PR 标题**: `feat(brain+dashboard): harness graph streamMode 节点级进度 → LiveMonitor`

**依赖**: 与 W3 互补（signal 仍传）；与 W1/W2 不冲突

---

### Work Stream 5: interrupt() 关键决策点

**目标**: 凭据 401 / PRD ambiguous / Final E2E FAIL 等"该问主理人"的场景，用 LangGraph 的 `interrupt()` 暂停 graph，把 prompt 推到 Dashboard，主理人 click resume → `Command({ resume: ... })` 继续。

**改动文件**:
- `packages/brain/src/workflows/harness-initiative.graph.js`（在 planner / final_evaluate node 内插入 interrupt）
- `packages/brain/src/routes/harness-interrupts.js` ← **新路由**（GET 列出待处理 interrupt / POST resume）
- `apps/dashboard/src/pages/HarnessInterrupts.tsx` ← **新页面**

**API 用法**:

```js
// graph.js — final_evaluate node 内
import { interrupt } from '@langchain/langgraph';

export async function finalEvaluateDispatchNode(state, opts) {
  // ... 跑 final E2E ...
  if (state.final_e2e_verdict === 'FAIL' && state.fix_round >= MAX_FIX_ROUNDS) {
    // 自动 fix 用尽，问主理人
    const decision = interrupt({
      type: 'final_e2e_failed_max_fix',
      initiative_id: state.initiativeId,
      failed_scenarios: state.final_e2e_failed_scenarios,
      message: 'Final E2E 已重试 3 次仍失败。是否：(a) 终止 (b) 增加 fix_round 限额再试 (c) 标 sprint failed 但接受',
    });
    if (decision.action === 'abort') return { error: { node: 'final_evaluate', message: 'aborted by operator' } };
    if (decision.action === 'extend_fix_rounds') return { fix_round: state.fix_round, allow_extra: 3 };
    if (decision.action === 'accept_failed') return { final_e2e_verdict: 'PASS_WITH_OVERRIDE' };
  }
  // ...
}

// resume 路由（routes/harness-interrupts.js）：
router.post('/api/brain/harness-interrupts/:taskId/resume', async (req, res) => {
  const { decision } = req.body;
  // 重新 invoke graph，传 Command({ resume: decision })
  const compiled = await compileHarnessFullGraph();
  const result = await compiled.invoke(
    new Command({ resume: decision }),
    { configurable: { thread_id: threadIdFromTaskId(req.params.taskId) } }
  );
  res.json({ ok: true, result });
});
```

**DoD**:
- [BEHAVIOR] `tests/integration/harness-interrupt-resume.test.ts` — graph 跑到 final_evaluate 触发 interrupt，task_events 写一行 type='interrupt_pending'，Dashboard route GET 返回该 interrupt，POST resume 继续 graph
- [ARTIFACT] HarnessInterrupts 页面渲染待处理列表 + 决策按钮
- [ARTIFACT] LANGGRAPH-INTERNALS.md 记录 interrupt 触发条件清单

**PR 标题**: `feat(brain+dashboard): harness graph interrupt() — final_e2e 失败/凭据故障问主理人`

**依赖**: 在 W4 streamMode 之后做更顺（stream 事件类型扩 interrupt_pending）

---

### Work Stream 6: docker-executor OOM Promise reject 边界 bug

**目标**: 修 docker-executor 在 SIGKILL（exit=137）/ stdout EOF 异常时不 reject Promise 的边界 bug。这是 W1 stuck 的最底层根因。

**改动文件**:
- `packages/brain/src/docker-executor.js`（核心修复点）
- `packages/brain/src/spawn/middleware/docker-run.js`（spawn 路径同 bug）

**调研步骤**（agent 必做）:
1. 读 `docker-executor.js` 全文（536 行）+ `spawn/middleware/docker-run.js`
2. 定位所有 `child.on('exit', ...)` / `child.on('close', ...)` / Promise 构造
3. 找出"exit=137 但 reject 没调"的路径
4. 同步检查 stdout chunked 读取超时是否会留下挂起的 Promise

**DoD**:
- [BEHAVIOR] `tests/integration/docker-executor-oom.test.ts` — mock 一个 docker run 让其立即 exit=137，executeInDocker Promise 在 100ms 内 reject 出 `OOM_killed` 错误
- [BEHAVIOR] `tests/integration/docker-executor-stdout-eof.test.ts` — mock stdout 中途 EOF，Promise reject 不 hang
- [ARTIFACT] PR #2805 的内容如果未合可以并入此 PR

**PR 标题**: `fix(brain): docker-executor OOM/SIGKILL Promise 必 reject — 修 invoke hang 根因`

**依赖**: 是 W1-W5 的底层依赖（最先合最稳）。可与 W1/W2 并行开发，独立验证。

---

### Work Stream 7: 运维清单 A-G + 4 个 Conflict PR

**目标**: 把 user 列表里的运维项一次清掉，作为单独 PR 系列（**不混进 LangGraph 改动**）。

**子任务列表**:

| 子项 | 内容 | PR 单独 |
|---|---|---|
| 7.1 | rebase #2803（embedding-service quota 退避）、#2804（api-credentials-checker）、#2805（docker-executor OOM alert，可与 W6 合并）；close #2802（已被 main 上 266_fix_progress_ledger_unique 取代）| 4 |
| 7.2 | Bug #D：circuit-breaker reset API + 前端按钮（POST `/api/brain/circuit-breaker/:key/reset`）| 1 |
| 7.3 | Bug #E：startup-recovery `cleanupStaleWorktrees` 加"活跃 lock 保护"（不清正在用的 worktree）| 1 |
| 7.4 | Bug #G：CI 加 `lint-migration-unique-version.cjs` 防同号 migration | 1 |
| 7.5 | Bug #A 代码侧：把 `api-credentials-checker.js`（来自 #2804）接入 `credentials-health-scheduler.js` daily/hourly 巡检 | 1（#2804 之后）|
| 7.6 | Bug #B：unmute Feishu webhook（curl PATCH /api/brain/settings/muted enabled=false），验证 P0 alert 能到 | 1（无代码改动，运维操作 + smoke 文档）|

**Bug #C**（LangGraph stuck guard）是 W1+W3 的整体修复，不在 7.x 内单独修。

**Bug #F**（dispatch API 返回 error 但实际成功）独立小 fix，加入 7.x 系列：

| 7.7 | `routes/tasks.js` dispatch endpoint 错误返回清理 | 1 |

**总 PR 数**: 4 rebase + 6 新 = 10 个独立 PR。

**Agent 分工**: 一个 agent 承接全部 7.x（顺序执行：7.6 unmute 立即做、7.1 rebase 4 个、7.2-7.7 6 个独立 PR 串行）。或拆 2 个 agent 并行（一个 rebase、一个独立 PR）。

---

## 3. 依赖图与并行计划

```
W6 (docker-executor bug)  ────┐
                              ├──→ W1 (thread_id 版本化)  ──┐
                              │                               ├──→ W3 (AbortSignal+watchdog)
                              ├──→ W2 (RetryPolicy)         ─┘                    │
                              │                                                    ├──→ W4 (streamMode)
                              │                                                    │           │
                              │                                                    │           └─→ W5 (interrupt)
                              │
W7 (运维清单 + rebase) ────────┴────── 全程并行（独立 PR），不阻塞 W1-W6
```

**并行批次**:
- **批次 1（立即并行启动）**: W6 + W7.1 (rebase) + W7.2 (CB reset) + W7.4 (migration lint) + W7.6 (Feishu unmute) + W7.7 (dispatch fix)
- **批次 2（W6 合并后）**: W1 + W2
- **批次 3（W1+W2 合并后）**: W3 + W4
- **批次 4（W4 合并后）**: W5 + W7.3 (startup-recovery 保护) + W7.5 (凭据 scheduler 接入)
- **批次 5（全部合并后）**: 端到端 acceptance run

---

## 4. 端到端 Acceptance（最关键的"打通"标准）

### 4.1 Acceptance task

**新建一个 walking skeleton initiative**（避免 MJ1 旧 checkpoint 污染），描述完全自包含：

```
title: [Harness Acceptance] LangGraph 可靠性打通验证 — 一个 thin feature 端到端跑通
task_type: harness_initiative
priority: P1
description: 派一个最小 walking skeleton：单 thin feature（add a /api/brain/harness/health endpoint 返回 LangGraph 版本），E2E smoke = curl 该 endpoint 返回 200。
goal: 验证 W1-W5 + W6 + W7 都生效，全程无人干预跑通。
```

### 4.2 故障注入测试（最重要）

在 acceptance 跑期间故意注入 1 次故障：

- **场景 A**: 用 `docker kill <container>` SIGKILL 一个跑中的子任务 container — 验证 W6 + W2（retryPolicy）联动自动恢复，无手撕 SQL
- **场景 B**: 临时把 ANTHROPIC_API_KEY 改成无效 — 验证 W2 (retryOn=false 永久错) + W5 (interrupt) 联动暂停问主理人
- **场景 C**: 用 `UPDATE initiative_runs SET deadline_at = NOW() - interval '1 minute'` 强制逾期 — 验证 W3 (watchdog) 标 failed

### 4.3 验证清单

| 检查 | 期望 | 怎么验证 |
|---|---|---|
| 14 节点全过 | ✓ | task_events 表每个 node 有一条 update（W4）|
| 4 子 PR merge（如果该 acceptance 多 task）/ 1 子 PR merge（最小骨架）| ✓ | `gh pr list --state merged` 含 acceptance 关联 PR |
| KR 进度 +1% 或更多 | ✓ | OKR API 返回 |
| LiveMonitor 实时看到节点 | ✓ | 浏览器查看 + 截图 |
| 任意时刻能从 Dashboard kill 跑中 graph（手动 abort）| ✓ | POST `/api/brain/tasks/:id/abort` → AbortSignal 触发 |
| 故障 A/B/C 注入后系统自愈 | ✓ | 三个故障注入脚本执行后查 task 终态 |
| 全程无人干预（除 interrupt 该问的场景）| ✓ | 主理人不需要执行任何 SQL / kill -9 / 手动 reset |

---

## 5. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| W6 修 docker-executor 时引入 regression（生产任务被 kill）| 中 | 高 | 严格 unit test 覆盖 + canary：先发 W6 单独 PR，跑 24h 看 Brain 健康度 |
| W2 retryPolicy 误判导致永久错误也重试（账号锁死）| 中 | 中 | retryOn 函数白名单"绝不重试"错误（401/403/parseError），CI 单测覆盖 |
| W5 interrupt 在生产环境主理人不及时响应 → graph 永久挂起 | 低 | 中 | interrupt 自带 24h 超时，超时自动 timeout 当作 abort |
| 多 PR 并行合并冲突 | 中 | 低 | 严格按依赖图批次，同批次内避免改同一文件 |
| Acceptance 故障注入不真实（mock 太干净）| 中 | 中 | 故障注入用真 docker kill / DB UPDATE，不 mock |

---

## 6. 不在 scope 内（明确不做）

- 重写 LangGraph 引擎（用户已确认 MIT 库无需重写，不是 IP）
- 上 LangGraph Platform / Server 自托管（C2/C3 方案，跨进程编排今天用不上）
- 新业务 feature（除 acceptance 用的 health endpoint 外）
- Brain 进程级 HA（多副本、高可用）— 留到下个 initiative
- 修 MJ1 task `b10de974...` 本身（旧 checkpoint 已清，acceptance 跑新 task）

---

## 7. 度量

跑完整 initiative 后看：

| 度量 | Baseline（修前）| 目标 |
|---|---|---|
| harness_initiative 任务跑通率（30 天）| 不可知（多次手撕 SQL）| ≥ 90% 全自动跑通 |
| 平均 stuck 干预次数 / initiative | 多次 | 0 |
| Brain 重启后续跑 stuck 概率 | 100%（thread_id 不变）| 0%（attemptN 升） |
| 故障注入后自愈时间 | N/A（人工介入）| < 10min |

---

## 8. License 备注

`@langchain/langgraph` 1.2.9 **MIT License**：商用、闭源、卖 Cecelia、卖客户产品全部允许，无任何限制。本 spec 全部基于开源库 API，不引入 LangGraph Platform 等商业组件。

---

**Spec Author**: Cecelia + Alex 协同（2026-05-06 brainstorming session）
**Status**: 待 Alex 确认范围 → 进 writing-plans 写实施计划 → 派 team agents 执行
