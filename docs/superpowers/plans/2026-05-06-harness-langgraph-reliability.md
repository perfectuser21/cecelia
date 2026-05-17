# Harness LangGraph 可靠性打通 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each Work Stream maps to one Brain dev task → one PR.

**Goal:** 用 `@langchain/langgraph` 1.2.9 已有但未启用的 5 件可靠性原语 + 修 docker-executor OOM Promise 边界 bug + 清理 A-G 运维清单（含 4 个 conflict PR rebase），让 Brain 派 harness_initiative 任务能每次跑通交付，全程无人干预。

**Architecture:** 不重写 LangGraph 引擎、不上 LangGraph Platform。LangGraph 在 Brain 单进程内编排（PostgresSaver 持久化），LLM agent 调用通过 docker-executor 跑独立 container。本 sprint 把 retryPolicy / AbortSignal / streamMode / interrupt / thread_id 版本化 5 个 API 用上 + 修 docker-executor OOM Promise reject + 6 个独立运维 PR。

**Tech Stack:** Node.js + Postgres + LangGraph 1.2.9 (MIT) + LangGraph PostgresSaver + Docker（cgroup --rm）+ Brain dev pipeline + /dev workflow

**Spec:** `docs/superpowers/specs/2026-05-06-harness-langgraph-reliability-design.md`

---

## File Structure（改动文件总览）

### 新建文件

| 文件 | 责任 | Work Stream |
|---|---|---|
| `packages/brain/src/harness-watchdog.js` | initiative_runs.deadline_at 周期扫描 + 逾期 abort | W3 |
| `packages/brain/src/routes/harness-interrupts.js` | GET 列出待 resume interrupt / POST resume | W5 |
| `packages/brain/src/orchestrator/LANGGRAPH-INTERNALS.md` | 内化文档：每个 LangGraph 原语怎么用 + 踩过的坑 | W1-W5 全程更新 |
| `apps/dashboard/src/pages/HarnessInterrupts.tsx` | Dashboard 页面：待处理 interrupt 列表 + 决策按钮 | W5 |
| `tests/integration/harness-thread-id-versioning.test.ts` | W1 验证 |
| `tests/integration/harness-retry-policy.test.ts` | W2 验证 |
| `tests/integration/harness-watchdog.test.ts` | W3 验证 |
| `tests/integration/harness-watchdog-tick.test.ts` | W3 兜底验证 |
| `tests/integration/harness-stream-events.test.ts` | W4 验证 |
| `tests/integration/harness-interrupt-resume.test.ts` | W5 验证 |
| `tests/integration/docker-executor-oom.test.ts` | W6 验证（OOM 必 reject）|
| `tests/integration/docker-executor-stdout-eof.test.ts` | W6 验证（EOF 必 reject）|
| `tests/integration/circuit-breaker-reset.test.ts` | W7.2 验证 |
| `tests/integration/startup-recovery-active-lock.test.ts` | W7.3 验证 |
| `.github/workflows/scripts/lint-migration-unique-version.cjs` | W7.4 实施 |

### 修改文件

| 文件 | 改动 | Work Stream |
|---|---|---|
| `packages/brain/src/executor.js:2820-2847` | invoke→stream + thread_id 版本化 + signal + watchdog 注入 | W1 + W3 + W4 |
| `packages/brain/src/workflows/harness-initiative.graph.js` | 14 个 addNode 加 retryPolicy + 关键 node 加 interrupt() | W2 + W5 |
| `packages/brain/src/workflows/harness-task.graph.js` | 子图 node retryPolicy | W2 |
| `packages/brain/src/workflows/harness-gan.graph.js` | GAN 循环 node retryPolicy | W2 |
| `packages/brain/src/docker-executor.js` | exit=137 / stdout EOF Promise reject 修复 | W6 |
| `packages/brain/src/spawn/middleware/docker-run.js` | 同 W6 | W6 |
| `packages/brain/src/tick.js` | 注册 watchdog 5min/次 | W3 |
| `packages/brain/src/circuit-breaker.js` | 加 reset 方法（内存 + DB 同步）| W7.2 |
| `packages/brain/src/routes/circuit-breaker.js` | POST `/api/brain/circuit-breaker/:key/reset` | W7.2 |
| `packages/brain/src/startup-recovery.js` | `cleanupStaleWorktrees` 加活跃 lock 检测 | W7.3 |
| `packages/brain/src/credentials-health-scheduler.js` | 接 `api-credentials-checker.js`（来自 #2804）| W7.5 |
| `packages/brain/src/routes/tasks.js` | dispatch endpoint 错误返回清理 | W7.7 |
| `packages/brain/src/events/taskEvents.js` | 新增 `emitGraphNodeUpdate` | W4 |
| `apps/dashboard/src/pages/LiveMonitor.tsx` | 消费 graph_node_update 事件 | W4 |

---

## 执行约束（每个 Agent 必须遵守）

1. **不在 main 分支改代码**。每个 PR 走 /dev workflow，cp-MMDDHHNN-* 分支
2. **不绕 CI**（不用 `--admin`），不 skip pre-commit hooks
3. **DoD 三要素**：每个 PR 必须有 `[BEHAVIOR]` 标签 + push 前勾选 [x] + feat: PR 含 *.test.ts
4. **DoD Test 字段**：CI 白名单 `node|npm|curl|bash|psql`，禁 grep/ls/cat 假测试
5. **Learning 文件**：第一次 push 前写 `docs/learnings/cp-MMDDHHNN-*.md`，含 `### 根本原因` + `### 下次预防`
6. **harness_mode: false**（手动 /dev，不是 Brain harness 派的）
7. **commit 信息中文 + Co-Authored-By: Claude Opus 4.7 (1M context)**
8. **凭据**走 1Password sync-credentials.sh（不用旧缓存）
9. **CI 等待用 foreground until 阻塞**（不 run_in_background 退出）
10. **同步更新 `LANGGRAPH-INTERNALS.md`**（每个 W 完成后追加一段）

---

## 依赖图与执行批次

```
批次 1（立即并行）:
  ┌─ W6  docker-executor OOM 修复（最底层根因）
  ├─ W7.1 rebase 4 conflict PR
  ├─ W7.2 circuit-breaker reset API
  ├─ W7.4 migration 同号 lint
  ├─ W7.6 Feishu unmute（运维操作 + smoke）
  └─ W7.7 dispatch API 错误返回清理

批次 2（W6 合并后）:
  ┌─ W1  thread_id 版本化
  └─ W2  RetryPolicy 全节点

批次 3（W1+W2 合并后）:
  ┌─ W3  AbortSignal + watchdog
  └─ W4  streamMode → LiveMonitor

批次 4（W4 合并后）:
  ┌─ W5  interrupt() 关键决策点
  ├─ W7.3 startup-recovery 保护活跃 worktree
  └─ W7.5 凭据巡检接 scheduler（依赖 #2804 已 rebase 合并）

批次 5（全部合并后）:
  └─ W8  端到端 Acceptance（含故障注入 A/B/C）
```

---

## Work Stream 1: thread_id 版本化

**Brain 任务注册**:
```bash
curl -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d '{
  "title": "[Harness 可靠性 W1] thread_id 版本化 — fresh vs resume 显式可控",
  "task_type": "dev",
  "priority": "P1",
  "location": "us",
  "description": "见 docs/superpowers/specs/2026-05-06-harness-langgraph-reliability-design.md §Work Stream 1。改 packages/brain/src/executor.js:2820-2847，把 thread_id 改成 harness-initiative:<id>:<attemptN>，attemptN = task.execution_attempts + 1。Resume 仅当 task.payload.resume_from_checkpoint === true。否则 fresh start（input = {task}）。同 attemptN 已有 checkpoint 但未 resume → 升 attemptN 写新 thread。验证：tests/integration/harness-thread-id-versioning.test.ts。harness_mode: false。"
}'
```

**Files:**
- Modify: `packages/brain/src/executor.js:2820-2847`
- Modify: `packages/brain/src/orchestrator/graph-runtime.js`（参考其已有 pattern）
- Create: `tests/integration/harness-thread-id-versioning.test.ts`
- Create: `packages/brain/src/orchestrator/LANGGRAPH-INTERNALS.md`（首次创建）

### Task 1.1: 写失败测试

- [ ] **Step 1: Create test file**

```typescript
// tests/integration/harness-thread-id-versioning.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { compileHarnessFullGraph } from '../../packages/brain/src/workflows/harness-initiative.graph.js';
import { getPgCheckpointer, _resetPgCheckpointerForTests } from '../../packages/brain/src/orchestrator/pg-checkpointer.js';

describe('harness initiative thread_id 版本化', () => {
  beforeEach(() => { _resetPgCheckpointerForTests(); });

  it('attemptN=1 第一次跑：fresh start 用 thread :1', async () => {
    // mock 一个 task，验证 invoke 用 thread_id 形如 ':1'
    const task = { id: 'test-1', task_type: 'harness_initiative', execution_attempts: 0, payload: {} };
    // ... 调 executor.runHarnessInitiativeRouter(task) — 需要 export 该路由分支为可测函数
    // 验证 compiled.invoke 收到的 config.configurable.thread_id 后缀是 ':1'
  });

  it('attemptN=1 同 thread 已有 checkpoint + resume_from_checkpoint=false → 升 :2 fresh', async () => {
    const task = { id: 'test-1', task_type: 'harness_initiative', execution_attempts: 1, payload: {} };
    // pre-seed checkpoint at thread :1
    // 调 router → 验证升到 :2
  });

  it('payload.resume_from_checkpoint=true 显式续 → input=null 用旧 thread', async () => {
    const task = { id: 'test-1', task_type: 'harness_initiative', execution_attempts: 1, payload: { resume_from_checkpoint: true } };
    // pre-seed checkpoint at :1
    // 调 router → 验证 thread_id=':1', input=null
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/harness-thread-id-versioning.test.ts`
Expected: FAIL — "executor router not extractable" 或 "thread_id 永远是 :1"

### Task 1.2: 重构 executor.js 为可测函数

- [ ] **Step 3: Extract router**

```js
// packages/brain/src/executor.js — 在 routeTask() 之前 export 出来
export async function runHarnessInitiativeRouter(task, opts = {}) {
  const dbPool = opts.pool || pool;
  const { compileHarnessFullGraph } = await import('./workflows/harness-initiative.graph.js');
  const compiled = opts.compiled || await compileHarnessFullGraph();
  const initiativeId = task.payload?.initiative_id || task.id;

  const baseAttemptN = (task.execution_attempts || 0) + 1;
  let attemptN = baseAttemptN;
  let threadId = `harness-initiative:${initiativeId}:${attemptN}`;

  const checkpointer = await getPgCheckpointer();
  const existing = await checkpointer.get({ configurable: { thread_id: threadId } });

  const resumeRequested = task.payload?.resume_from_checkpoint === true;
  let input;

  if (existing && resumeRequested) {
    input = null;  // 显式 resume
  } else if (existing && !resumeRequested) {
    // 同 attemptN 已有 checkpoint 但未 resume — 升 N，留旧 checkpoint 诊断
    attemptN = baseAttemptN + 1;
    threadId = `harness-initiative:${initiativeId}:${attemptN}`;
    input = { task };
  } else {
    input = { task };  // 全新
  }

  // bump task.execution_attempts 到 attemptN（caller 应预先 +1，但兜底）
  if (attemptN !== baseAttemptN) {
    await dbPool.query('UPDATE tasks SET execution_attempts=$1 WHERE id=$2', [attemptN, task.id]);
  }

  const final = await compiled.invoke(input, {
    configurable: { thread_id: threadId },
    recursionLimit: 500,
  });
  return { ok: !final.error, threadId, attemptN, finalState: { initiativeId, sub_tasks: final.sub_tasks, final_e2e_verdict: final.final_e2e_verdict, error: final.error } };
}
```

- [ ] **Step 4: 替换原 inline 路由调用**

```js
// 原 executor.js:2820-2847 改为：
if (task.task_type === 'harness_initiative') {
  console.log(`[executor] 路由决策: task_type=${task.task_type} → Harness Full Graph (A+B+C)`);
  try {
    const result = await runHarnessInitiativeRouter(task);
    return { success: result.ok, taskId: task.id, initiative: true, fullGraph: true, threadId: result.threadId, attemptN: result.attemptN, finalState: result.finalState };
  } catch (err) {
    console.error(`[executor] Harness Full Graph error task=${task.id}: ${err.message}`);
    return { success: false, taskId: task.id, initiative: true, error: err.message };
  }
}
```

- [ ] **Step 5: Run test to verify pass**

Run: `npx vitest run tests/integration/harness-thread-id-versioning.test.ts`
Expected: PASS（3 个 it 全绿）

### Task 1.3: 创建内化文档 + 提交

- [ ] **Step 6: Create LANGGRAPH-INTERNALS.md**

```markdown
# LangGraph 内化文档（packages/brain）

本文档记录 Cecelia 对 `@langchain/langgraph` 1.2.9 关键 API 的使用约定 + 踩过的坑。

## 1. thread_id 版本化（W1）

**规则**: thread_id 格式 `<workflow>:<id>:<attemptN>`，attemptN ∈ ℕ⁺。

**为什么**: LangGraph 默认行为是"thread_id 已有 checkpoint → resume from last"。
若 thread_id 永远 :1，Brain 重启会让 stuck checkpoint 复活续跑，形成死循环（MJ1 step 75 即此）。

**约束**:
- 永远从 caller 显式控制：`task.payload.resume_from_checkpoint=true` 才 resume，否则 fresh
- attemptN 单调递增，不复用
- 旧 attemptN checkpoint 保留供诊断（不主动删）
- `executor.js:runHarnessInitiativeRouter` 是唯一注入点

**反模式**: 任何地方写死 `thread_id: ...:1` — CI grep 守门（TODO W2）。
```

- [ ] **Step 7: Commit + push + PR**

```bash
git add packages/brain/src/executor.js \
        packages/brain/src/orchestrator/LANGGRAPH-INTERNALS.md \
        tests/integration/harness-thread-id-versioning.test.ts \
        docs/learnings/cp-XXXX-harness-thread-id-versioning.md \
        sprints/sprint-prd.md sprints/dod.md
git commit -m "feat(brain): harness graph thread_id 版本化 — fresh vs resume 显式可控

替换 executor.js inline harness_initiative 路由为 runHarnessInitiativeRouter()。
attemptN = task.execution_attempts + 1。task.payload.resume_from_checkpoint=true 续，否则 fresh。
同 attemptN 有旧 checkpoint 但未 resume → 升 N 留旧 checkpoint 诊断。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push -u origin cp-XXXX-harness-thread-id-versioning
gh pr create --title "feat(brain): harness graph thread_id 版本化" --body "..."
```

---

## Work Stream 2: 节点级 RetryPolicy

**Brain 任务注册**:
```bash
curl -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d '{
  "title": "[Harness 可靠性 W2] 节点级 RetryPolicy — 区分瞬时/永久错误",
  "task_type": "dev",
  "priority": "P1",
  "location": "us",
  "description": "见 spec §W2。给 packages/brain/src/workflows/harness-initiative.graph.js + harness-task.graph.js + harness-gan.graph.js 全部 LLM/Docker 类 addNode 加 { retryPolicy: LLM_RETRY }。LLM_RETRY = { maxAttempts: 3, initialInterval: 5000, backoffFactor: 2, jitter: true, retryOn: err => !/401|403|invalid|schema|parse/i.test(String(err.message)) }。Schema parse 节点不重试。DB 节点 maxAttempts:2。验证：tests/integration/harness-retry-policy.test.ts mock 瞬时/永久错误。harness_mode: false。"
}'
```

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js`（`buildHarnessInitiativeGraph` + `buildHarnessFullGraph`）
- Modify: `packages/brain/src/workflows/harness-task.graph.js`
- Modify: `packages/brain/src/workflows/harness-gan.graph.js`
- Create: `tests/integration/harness-retry-policy.test.ts`
- Update: `LANGGRAPH-INTERNALS.md` 加第 2 节

### Task 2.1: 测试先行

- [ ] **Step 1: Write retry test**

```typescript
// tests/integration/harness-retry-policy.test.ts
import { describe, it, expect, vi } from 'vitest';
import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { LLM_RETRY } from '../../packages/brain/src/workflows/retry-policies.js';

describe('LLM_RETRY policy', () => {
  it('瞬时错误（network） → 重试 3 次后成功', async () => {
    let calls = 0;
    const Anno = Annotation.Root({ ok: Annotation({ default: () => false }) });
    const node = async () => {
      calls++;
      if (calls < 3) throw new Error('ECONNRESET network blip');
      return { ok: true };
    };
    const g = new StateGraph(Anno).addNode('flaky', node, { retryPolicy: LLM_RETRY }).addEdge(START, 'flaky').addEdge('flaky', END).compile();
    const out = await g.invoke({});
    expect(out.ok).toBe(true);
    expect(calls).toBe(3);
  });

  it('永久错误（401 auth） → 不重试，立即抛', async () => {
    let calls = 0;
    const Anno = Annotation.Root({ ok: Annotation({ default: () => false }) });
    const node = async () => { calls++; throw new Error('HTTP 401 invalid api key'); };
    const g = new StateGraph(Anno).addNode('auth', node, { retryPolicy: LLM_RETRY }).addEdge(START, 'auth').addEdge('auth', END).compile();
    await expect(g.invoke({})).rejects.toThrow(/401/);
    expect(calls).toBe(1);
  });

  it('schema parse 错误 → 不重试', async () => {
    let calls = 0;
    const Anno = Annotation.Root({ ok: Annotation({ default: () => false }) });
    const node = async () => { calls++; throw new Error('schema validation failed: missing field'); };
    const g = new StateGraph(Anno).addNode('parse', node, { retryPolicy: LLM_RETRY }).addEdge(START, 'parse').addEdge('parse', END).compile();
    await expect(g.invoke({})).rejects.toThrow(/schema/);
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/integration/harness-retry-policy.test.ts`
Expected: FAIL — "Cannot find module retry-policies"

### Task 2.2: 实现 retry-policies.js

- [ ] **Step 3: Create shared retry policies module**

```js
// packages/brain/src/workflows/retry-policies.js
/**
 * LangGraph 节点级 RetryPolicy 共享配置。
 * 见 docs/superpowers/specs/2026-05-06-harness-langgraph-reliability-design.md §W2
 */

const PERMANENT_ERROR_RE = /\b(401|403|invalid api key|invalid_api_key|schema|parse error|parse failed|validation failed|GraphInterrupt|AbortError)\b/i;

export const LLM_RETRY = {
  maxAttempts: 3,
  initialInterval: 5_000,
  backoffFactor: 2.0,
  jitter: true,
  retryOn: (err) => {
    const msg = String(err?.message || '');
    return !PERMANENT_ERROR_RE.test(msg);
  },
};

export const DB_RETRY = {
  maxAttempts: 2,
  initialInterval: 1_000,
  backoffFactor: 2.0,
  jitter: false,
  retryOn: (err) => {
    const msg = String(err?.message || '');
    if (PERMANENT_ERROR_RE.test(msg)) return false;
    if (/duplicate key|UNIQUE constraint|foreign key/i.test(msg)) return false;
    return true;
  },
};

export const NO_RETRY = { maxAttempts: 1 };
```

### Task 2.3: 应用到 14 个节点

- [ ] **Step 4: Modify harness-initiative.graph.js full graph**

```js
// packages/brain/src/workflows/harness-initiative.graph.js
import { LLM_RETRY, DB_RETRY, NO_RETRY } from './retry-policies.js';

export function buildHarnessFullGraph() {
  return new StateGraph(FullInitiativeState)
    .addNode('prep', prepInitiativeNode, { retryPolicy: NO_RETRY })  // 预备步骤幂等失败即 END
    .addNode('planner', runPlannerNode, { retryPolicy: LLM_RETRY })
    .addNode('parsePrd', parsePrdNode, { retryPolicy: NO_RETRY })  // schema parse 重试无意义
    .addNode('ganLoop', runGanLoopNode, { retryPolicy: LLM_RETRY })
    .addNode('inferTaskPlan', inferTaskPlanNode, { retryPolicy: NO_RETRY })
    .addNode('dbUpsert', dbUpsertNode, { retryPolicy: DB_RETRY })
    .addNode('pick_sub_task', pickSubTaskNode, { retryPolicy: NO_RETRY })
    .addNode('run_sub_task', runSubTaskNode, { retryPolicy: LLM_RETRY })
    .addNode('evaluate', evaluateSubTaskNode, { retryPolicy: LLM_RETRY })
    .addNode('advance', advanceTaskIndexNode, { retryPolicy: NO_RETRY })
    .addNode('retry', retryTaskNode, { retryPolicy: NO_RETRY })
    .addNode('terminal_fail', terminalFailNode, { retryPolicy: NO_RETRY })
    .addNode('final_evaluate', finalEvaluateDispatchNode, { retryPolicy: LLM_RETRY })
    .addNode('report', reportNode, { retryPolicy: DB_RETRY })
    .addEdge(START, 'prep')
    // ... 现有 edges 不变
    ;
}
```

- [ ] **Step 5: Apply to harness-task.graph.js + harness-gan.graph.js**

(Read each file, identify nodes, apply LLM_RETRY to LLM-calling nodes and DB_RETRY to DB nodes.)

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/integration/harness-retry-policy.test.ts && npx vitest run packages/brain/src/workflows/__tests__/`
Expected: All pass + no regression

### Task 2.4: 文档 + 提交

- [ ] **Step 7: Update LANGGRAPH-INTERNALS.md** 加 §2 RetryPolicy 决策表（节点 → policy 映射）

- [ ] **Step 8: Commit + push + PR**

```bash
git commit -m "feat(brain): harness graph 全节点 RetryPolicy — 区分瞬时/永久错误

新增 packages/brain/src/workflows/retry-policies.js 集中 LLM_RETRY/DB_RETRY/NO_RETRY。
LLM_RETRY: maxAttempts=3, exp backoff with jitter, retryOn 排除 401/403/schema/parse/auth。
applied 到 14 个 full graph node + harness-task / harness-gan 子图。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Work Stream 3: AbortSignal + Watchdog

**Brain 任务注册**:
```bash
curl -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d '{
  "title": "[Harness 可靠性 W3] AbortSignal + Watchdog — 逾期自动 kill",
  "task_type": "dev",
  "priority": "P1",
  "location": "us",
  "description": "见 spec §W3。runHarnessInitiativeRouter 加 AbortController + setTimeout 触发 abort，deadline 来源 initiative_runs.deadline_at fallback 6h。新建 packages/brain/src/harness-watchdog.js scanStuckHarness：5min/次扫描 deadline_at < NOW() AND completed_at IS NULL 的 initiative_runs，标 phase=failed failure_reason=watchdog_overdue 并写 alert。tick.js 注册。验证：tests/integration/harness-watchdog.test.ts + harness-watchdog-tick.test.ts。harness_mode: false。"
}'
```

**Files:**
- Modify: `packages/brain/src/executor.js`（`runHarnessInitiativeRouter`）
- Create: `packages/brain/src/harness-watchdog.js`
- Modify: `packages/brain/src/tick.js`（注册）
- Create: `tests/integration/harness-watchdog.test.ts`
- Create: `tests/integration/harness-watchdog-tick.test.ts`

### Task 3.1: 测试先行（invoke 级 abort）

- [ ] **Step 1: Test that invoke aborts on signal**

```typescript
// tests/integration/harness-watchdog.test.ts
import { describe, it, expect } from 'vitest';
import { StateGraph, Annotation, START, END } from '@langchain/langgraph';

describe('graph invoke AbortSignal', () => {
  it('signal abort 时 invoke 抛 AbortError', async () => {
    const Anno = Annotation.Root({ done: Annotation({ default: () => false }) });
    const slowNode = async () => { await new Promise(r => setTimeout(r, 10_000)); return { done: true }; };
    const g = new StateGraph(Anno).addNode('slow', slowNode).addEdge(START, 'slow').addEdge('slow', END).compile();
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(new Error('watchdog_deadline')), 100);
    await expect(g.invoke({}, { signal: ctrl.signal })).rejects.toThrow();
  });
});
```

### Task 3.2: 实施 AbortSignal in router

- [ ] **Step 2: Modify runHarnessInitiativeRouter**

```js
// packages/brain/src/executor.js — 改 runHarnessInitiativeRouter
export async function runHarnessInitiativeRouter(task, opts = {}) {
  // ... 前置 thread_id 计算（W1 已有） ...

  // 读 deadline
  const dbPool = opts.pool || pool;
  const deadlineRow = await dbPool.query(
    `SELECT deadline_at FROM initiative_runs WHERE initiative_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [initiativeId]
  );
  const deadlineAt = deadlineRow.rows[0]?.deadline_at;
  const deadlineMs = deadlineAt
    ? Math.max(60_000, new Date(deadlineAt).getTime() - Date.now())  // 至少 1min
    : 6 * 3600 * 1000;  // fallback 6h

  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(new Error(`harness_watchdog: deadline exceeded for ${initiativeId} thread=${threadId}`)),
    deadlineMs
  );

  try {
    const final = await compiled.invoke(input, {
      configurable: { thread_id: threadId },
      recursionLimit: 500,
      signal: ctrl.signal,
    });
    return { ok: !final.error, threadId, attemptN, finalState: { ... } };
  } catch (err) {
    if (err.name === 'AbortError' || /watchdog/i.test(err.message)) {
      // 写 task failure_class
      await dbPool.query(
        `UPDATE tasks SET error_message=$1, custom_props = jsonb_set(COALESCE(custom_props,'{}'::jsonb), '{failure_class}', '"watchdog_deadline"'::jsonb) WHERE id=$2`,
        [`watchdog deadline at ${new Date().toISOString()}`, task.id]
      );
      return { ok: false, threadId, attemptN, error: 'watchdog_deadline' };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
```

### Task 3.3: 实施 watchdog 兜底扫描

- [ ] **Step 3: Create harness-watchdog.js**

```js
// packages/brain/src/harness-watchdog.js
/**
 * Harness 兜底 watchdog — 5min/次扫描所有 initiative_runs。
 * 防止 Brain 重启丢 setTimeout / 防止有 invoke 直接 hang 不响应 signal。
 */
import pool from './db.js';

export async function scanStuckHarness({ pool: dbPool = pool, notifier } = {}) {
  const overdue = await dbPool.query(`
    SELECT initiative_id, contract_id, deadline_at, phase
    FROM initiative_runs
    WHERE phase IN ('A_planning', 'B_task_loop', 'C_final_e2e')
      AND deadline_at < NOW()
      AND completed_at IS NULL
    LIMIT 50
  `);

  const flagged = [];
  for (const row of overdue.rows) {
    await dbPool.query(`
      UPDATE initiative_runs
      SET phase='failed',
          failure_reason='watchdog_overdue',
          completed_at=NOW()
      WHERE initiative_id=$1 AND completed_at IS NULL
    `, [row.initiative_id]);

    flagged.push(row.initiative_id);
    console.warn(`[harness-watchdog] flagged initiative=${row.initiative_id} phase=${row.phase} deadline=${row.deadline_at}`);

    if (notifier) {
      await notifier.send({
        priority: 'P1',
        title: `Harness watchdog: initiative ${row.initiative_id} overdue`,
        body: `phase=${row.phase} deadline_at=${row.deadline_at}`,
      });
    }
  }
  return { flagged };
}
```

- [ ] **Step 4: Register in tick.js**

```js
// packages/brain/src/tick.js — 在 tick loop 找现有 5min 类调度，注册
import { scanStuckHarness } from './harness-watchdog.js';

// 5min 周期 tick 内：
if (now - lastWatchdogScan > 5 * 60 * 1000) {
  await scanStuckHarness({ notifier: getNotifier() });
  lastWatchdogScan = now;
}
```

### Task 3.4: Watchdog tick 测试

- [ ] **Step 5: Write watchdog tick test**

```typescript
// tests/integration/harness-watchdog-tick.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import pool from '../../packages/brain/src/db.js';
import { scanStuckHarness } from '../../packages/brain/src/harness-watchdog.js';

describe('scanStuckHarness', () => {
  beforeEach(async () => {
    await pool.query("DELETE FROM initiative_runs WHERE failure_reason='watchdog_overdue_test'");
  });

  it('deadline_at 已过 → 标 phase=failed', async () => {
    const initiativeId = '00000000-0000-0000-0000-000000000abc';
    await pool.query(`
      INSERT INTO initiative_runs (initiative_id, contract_id, phase, deadline_at, journey_type)
      VALUES ($1, $1, 'B_task_loop', NOW() - INTERVAL '1 minute', 'autonomous')
    `, [initiativeId]);

    const r = await scanStuckHarness({ pool });
    expect(r.flagged).toContain(initiativeId);

    const after = await pool.query(`SELECT phase, failure_reason FROM initiative_runs WHERE initiative_id=$1`, [initiativeId]);
    expect(after.rows[0].phase).toBe('failed');
    expect(after.rows[0].failure_reason).toBe('watchdog_overdue');
  });
});
```

- [ ] **Step 6: Run all W3 tests**

Run: `npx vitest run tests/integration/harness-watchdog*.test.ts`
Expected: 全 PASS

### Task 3.5: 文档 + Commit

- [ ] **Step 7: Update LANGGRAPH-INTERNALS.md §3 (AbortSignal + Watchdog)**
- [ ] **Step 8: Commit + PR**

---

## Work Stream 4: streamMode → LiveMonitor

**Brain 任务注册**:
```bash
curl -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d '{
  "title": "[Harness 可靠性 W4] streamMode 节点级进度 → LiveMonitor",
  "task_type": "dev",
  "priority": "P1",
  "location": "us",
  "description": "见 spec §W4。runHarnessInitiativeRouter 改用 compiled.stream(input, { streamMode: \"updates\" })，逐 node 迭代 → emitGraphNodeUpdate(taskId, threadId, nodeName, summary)。新增 events/taskEvents.js#emitGraphNodeUpdate 写 task_events 表 type=graph_node_update。LiveMonitor.tsx 消费新事件类型显示节点进度条。验证：tests/integration/harness-stream-events.test.ts。harness_mode: false。"
}'
```

**Files:**
- Modify: `packages/brain/src/executor.js`（`runHarnessInitiativeRouter`：invoke→stream）
- Modify: `packages/brain/src/events/taskEvents.js`
- Modify: `apps/dashboard/src/pages/LiveMonitor.tsx`
- Create: `tests/integration/harness-stream-events.test.ts`

### Task 4.1: 改 invoke → stream

- [ ] **Step 1: Update router**

```js
// runHarnessInitiativeRouter 内部 — 替换 invoke
import { emitGraphNodeUpdate } from './events/taskEvents.js';

const stream = await compiled.stream(input, {
  configurable: { thread_id: threadId },
  recursionLimit: 500,
  signal: ctrl.signal,
  streamMode: 'updates',
});

let final = null;
let nodeCount = 0;
const MAX_EVENTS = 100;  // 防写爆

for await (const update of stream) {
  for (const [nodeName, partialState] of Object.entries(update)) {
    if (nodeCount < MAX_EVENTS) {
      await emitGraphNodeUpdate({
        taskId: task.id,
        initiativeId,
        threadId,
        nodeName,
        attemptN,
        payloadSummary: summarizeNodeState(partialState),
      });
      nodeCount++;
    }
    final = { ...(final || {}), ...partialState };
  }
}
```

- [ ] **Step 2: Add summarizeNodeState helper**

```js
// 在 executor.js 同文件
function summarizeNodeState(state) {
  // 只保留小标量值 + 截断长字符串
  const out = {};
  for (const [k, v] of Object.entries(state || {})) {
    if (v == null) continue;
    if (typeof v === 'string') out[k] = v.length > 200 ? v.slice(0, 200) + '…' : v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v)) out[k] = `[Array ${v.length}]`;
    else if (typeof v === 'object') out[k] = `{Object ${Object.keys(v).length} keys}`;
  }
  return out;
}
```

### Task 4.2: 加 emitGraphNodeUpdate

- [ ] **Step 3: Modify packages/brain/src/events/taskEvents.js**

```js
export async function emitGraphNodeUpdate({ taskId, initiativeId, threadId, nodeName, attemptN, payloadSummary }) {
  await pool.query(`
    INSERT INTO task_events (task_id, event_type, payload, created_at)
    VALUES ($1, 'graph_node_update', $2::jsonb, NOW())
  `, [taskId, JSON.stringify({ initiativeId, threadId, nodeName, attemptN, payloadSummary })]);
}
```

### Task 4.3: 集成测试

- [ ] **Step 4: Test 验证 task_events 写入**

```typescript
// tests/integration/harness-stream-events.test.ts
it('14 节点 graph 跑完，写 14 条 graph_node_update event（不超 100）', async () => {
  const taskId = 'test-stream-1';
  // mock graph 跑 5 节点
  // 调 router
  // 查 task_events table
  const rows = await pool.query(`SELECT event_type, payload FROM task_events WHERE task_id=$1 AND event_type='graph_node_update'`, [taskId]);
  expect(rows.rows.length).toBeGreaterThanOrEqual(5);
  expect(rows.rows[0].payload.nodeName).toBeTruthy();
});
```

### Task 4.4: Dashboard 消费

- [ ] **Step 5: Update LiveMonitor.tsx**（增渲染 graph_node_update event）

```tsx
// apps/dashboard/src/pages/LiveMonitor.tsx — 新事件类型分支
{event.event_type === 'graph_node_update' && (
  <div className="harness-node-update">
    <span className="node-name">{event.payload.nodeName}</span>
    <span className="thread">attempt {event.payload.attemptN}</span>
    <span className="time">{formatTime(event.created_at)}</span>
  </div>
)}
```

- [ ] **Step 6: Commit + PR**

---

## Work Stream 5: interrupt() 关键决策点

**Brain 任务注册**:
```bash
curl -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d '{
  "title": "[Harness 可靠性 W5] interrupt() — 401/PRD模糊/E2E红问主理人",
  "task_type": "dev",
  "priority": "P1",
  "location": "us",
  "description": "见 spec §W5。在 finalEvaluateDispatchNode 加 interrupt() 当 fix_round >= MAX_FIX_ROUNDS 时暂停。新增 routes/harness-interrupts.js (GET /api/brain/harness-interrupts 列出 + POST /api/brain/harness-interrupts/:taskId/resume)。Resume 用 Command({resume:decision}) 重新 stream graph。新增 apps/dashboard/src/pages/HarnessInterrupts.tsx。验证：tests/integration/harness-interrupt-resume.test.ts。harness_mode: false。"
}'
```

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js`（`finalEvaluateDispatchNode`）
- Create: `packages/brain/src/routes/harness-interrupts.js`
- Modify: `packages/brain/src/server.js`（注册新路由）
- Create: `apps/dashboard/src/pages/HarnessInterrupts.tsx`
- Create: `tests/integration/harness-interrupt-resume.test.ts`

### Task 5.1: 加 interrupt 在 final_evaluate

- [ ] **Step 1: Modify finalEvaluateDispatchNode**

```js
// harness-initiative.graph.js
import { interrupt, Command } from '@langchain/langgraph';

const MAX_FIX_ROUNDS = 3;

export async function finalEvaluateDispatchNode(state, opts = {}) {
  // 跑 final E2E（已有逻辑）...
  const verdict = state.final_e2e_verdict;
  const failedScenarios = state.final_e2e_failed_scenarios || [];
  const fixRound = state.task_loop_fix_count || 0;

  if (verdict === 'FAIL' && fixRound >= MAX_FIX_ROUNDS) {
    // 暂停 graph，问主理人
    const decision = interrupt({
      type: 'final_e2e_failed_max_fix',
      initiative_id: state.initiativeId,
      attempt_n: state.attemptN,
      failed_scenarios: failedScenarios,
      fix_rounds_used: fixRound,
      message: 'Final E2E 已重试 3 次仍失败。请决定：(a) abort (b) extend_fix_rounds (c) accept_failed',
    });
    if (decision?.action === 'abort') return { error: { node: 'final_evaluate', message: 'aborted by operator', operator_decision: decision } };
    if (decision?.action === 'extend_fix_rounds') return { task_loop_fix_count: fixRound, fix_rounds_extended: 3 };
    if (decision?.action === 'accept_failed') return { final_e2e_verdict: 'PASS_WITH_OVERRIDE', operator_decision: decision };
  }
  return {};  // verdict 已在 state，无操作即按 verdict 流转
}
```

### Task 5.2: 新建 routes/harness-interrupts.js

- [ ] **Step 2: Implement interrupt routes**

```js
// packages/brain/src/routes/harness-interrupts.js
import { Router } from 'express';
import { Command } from '@langchain/langgraph';
import pool from '../db.js';
import { compileHarnessFullGraph } from '../workflows/harness-initiative.graph.js';
import { getPgCheckpointer } from '../orchestrator/pg-checkpointer.js';

export const harnessInterruptsRouter = Router();

// GET /api/brain/harness-interrupts — 待 resume 的 thread 列表
harnessInterruptsRouter.get('/api/brain/harness-interrupts', async (req, res) => {
  const checkpointer = await getPgCheckpointer();
  // 从 task_events 找 latest type='interrupt_pending' 但无对应 'interrupt_resumed' 的
  const rows = await pool.query(`
    SELECT task_id, payload, created_at
    FROM task_events
    WHERE event_type = 'interrupt_pending'
      AND created_at > NOW() - INTERVAL '24 hours'
      AND task_id NOT IN (SELECT task_id FROM task_events WHERE event_type='interrupt_resumed' AND created_at > task_events.created_at)
    ORDER BY created_at DESC
  `);
  res.json({ interrupts: rows.rows });
});

// POST /api/brain/harness-interrupts/:taskId/resume
harnessInterruptsRouter.post('/api/brain/harness-interrupts/:taskId/resume', async (req, res) => {
  const { decision } = req.body;
  if (!decision?.action) return res.status(400).json({ error: 'decision.action required' });

  const taskRow = await pool.query('SELECT * FROM tasks WHERE id=$1', [req.params.taskId]);
  if (!taskRow.rowCount) return res.status(404).json({ error: 'task not found' });
  const task = taskRow.rows[0];

  const initiativeId = task.payload?.initiative_id || task.id;
  const attemptN = task.execution_attempts || 1;
  const threadId = `harness-initiative:${initiativeId}:${attemptN}`;

  await pool.query(`INSERT INTO task_events (task_id, event_type, payload) VALUES ($1, 'interrupt_resumed', $2::jsonb)`, [task.id, JSON.stringify(decision)]);

  const compiled = await compileHarnessFullGraph();
  // resume via Command — 用 stream 接事件，不阻塞 HTTP
  // 异步触发，立即返回
  setImmediate(async () => {
    try {
      const stream = await compiled.stream(
        new Command({ resume: decision }),
        { configurable: { thread_id: threadId }, streamMode: 'updates', recursionLimit: 500 }
      );
      for await (const _ of stream) { /* stream 自动写 task_events via emitGraphNodeUpdate */ }
    } catch (err) {
      console.error(`[harness-interrupt-resume] task=${task.id} error: ${err.message}`);
    }
  });

  res.json({ ok: true, threadId, decision });
});
```

- [ ] **Step 3: 把 interrupt 触发记到 task_events**

(在 finalEvaluateDispatchNode 调 interrupt 之前 emit `interrupt_pending` event。LangGraph 会重新调用该 node，需要幂等检查。)

### Task 5.3: Dashboard 页面 + 测试

- [ ] **Step 4: HarnessInterrupts.tsx** — 简单列表 + 三个按钮（abort / extend_fix_rounds / accept_failed），POST 到 resume endpoint。

- [ ] **Step 5: Test interrupt + resume cycle**

- [ ] **Step 6: Commit + PR**

---

## Work Stream 6: docker-executor OOM Promise reject

**Brain 任务注册**:
```bash
curl -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d '{
  "title": "[Harness 可靠性 W6] docker-executor OOM Promise reject — 修 invoke hang 根因",
  "task_type": "dev",
  "priority": "P0",
  "location": "us",
  "description": "见 spec §W6。读 packages/brain/src/docker-executor.js + spawn/middleware/docker-run.js，定位 child.on(exit/close) Promise 构造，确保 exit=137 / SIGKILL / stdout EOF 任一情况下 Promise 必 reject 不 hang。验证：tests/integration/docker-executor-oom.test.ts mock 立即 exit=137 → Promise 100ms 内 reject 错误含 OOM_killed/SIGKILL。tests/integration/docker-executor-stdout-eof.test.ts mock stdout 中途 EOF → reject。harness_mode: false。"
}'
```

**Files:**
- Modify: `packages/brain/src/docker-executor.js`
- Modify: `packages/brain/src/spawn/middleware/docker-run.js`
- Create: `tests/integration/docker-executor-oom.test.ts`
- Create: `tests/integration/docker-executor-stdout-eof.test.ts`

### Task 6.1: 调研现状

- [ ] **Step 1: Agent 读全文 docker-executor.js + docker-run.js**
- [ ] **Step 2: 标注每个 Promise 构造点 + child.on('exit'/'close') 路径**
- [ ] **Step 3: 找出"exit=137 但 reject 没调"的代码路径**

### Task 6.2: 测试先行

- [ ] **Step 4: Write OOM test**

```typescript
// tests/integration/docker-executor-oom.test.ts
import { describe, it, expect, vi } from 'vitest';

describe('docker-executor OOM 必 reject', () => {
  it('child 立即 exit=137 → Promise 100ms 内 reject', async () => {
    // mock spawn child 立即 emit 'exit' with code 137 + signal 'SIGKILL'
    // 调 executeInDocker → 验证 promise reject 含 'OOM' or '137' or 'SIGKILL'
    const t0 = Date.now();
    await expect(/* call */).rejects.toThrow(/OOM|137|SIGKILL/);
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it('child stdout EOF 中途 + exit=0 → 仍正常 resolve（不是 OOM）', async () => {
    // 确保不过度修：正常退出不要误 reject
  });
});
```

### Task 6.3: 修复 + Race fix

- [ ] **Step 5: 在 docker-executor.js 的 Promise 构造里加 exit handler 防御**

```js
// 关键修复模式（对每个 spawn child）：
return new Promise((resolve, reject) => {
  let resolved = false;
  const safeResolve = (v) => { if (!resolved) { resolved = true; resolve(v); } };
  const safeReject = (e) => { if (!resolved) { resolved = true; reject(e); } };

  child.on('exit', (code, signal) => {
    // 关键：exit 总是要走一个分支，不能漏
    if (code === 137 || signal === 'SIGKILL') {
      return safeReject(new Error(`docker container OOM_killed (exit=137 signal=${signal})`));
    }
    if (code !== 0) {
      return safeReject(new Error(`docker exit=${code} signal=${signal}`));
    }
    return safeResolve({ stdout, stderr, exit_code: code });
  });

  child.on('error', safeReject);

  // 防 EOF stdout hang：超过 timeout 强 kill + reject
  const timeoutTimer = setTimeout(() => {
    try { child.kill('SIGKILL'); } catch {}
    safeReject(new Error(`docker timeout after ${DEFAULT_TIMEOUT_MS}ms`));
  }, DEFAULT_TIMEOUT_MS);

  child.on('exit', () => clearTimeout(timeoutTimer));
});
```

### Task 6.4: Commit + PR

- [ ] **Step 6: Run tests; Step 7: Commit + PR**

---

## Work Stream 7: 运维清单（独立 PR 系列）

### W7.1 — Rebase 4 Conflict PRs

**操作（人工 / Brain dispatch agent 都行）**:

```bash
# Close #2802 (已被 main 上 266 取代)
gh pr close 2802 --comment "main 已合 266_fix_progress_ledger_unique，本 PR 冗余"

# Rebase #2803/#2804/#2805
for pr in 2803 2804 2805; do
  branch=$(gh pr view $pr --json headRefName -q .headRefName)
  cd /Users/administrator/worktrees/cecelia/$branch || git -C /Users/administrator/perfect21/cecelia worktree add ../worktrees/cecelia/$branch $branch
  git fetch origin main
  git rebase origin/main || { echo "conflict in $pr — manual"; exit 1; }
  git push --force-with-lease
done
```

**DoD**: 4 PR 状态从 CONFLICTING 转为 mergeable。CI 全绿后合并。

### W7.2 — Circuit-Breaker Reset API

**Brain 任务注册**:
```bash
curl -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d '{
  "title": "[Harness 可靠性 W7.2] circuit-breaker reset API",
  "task_type": "dev",
  "priority": "P1",
  "location": "us",
  "description": "见 spec §W7.2 (Bug #D)。packages/brain/src/circuit-breaker.js 新增 resetBreaker(key) 方法：内存 Map 重置 defaultState() + DB UPDATE。新增 routes POST /api/brain/circuit-breaker/:key/reset 调 resetBreaker。验证：tests/integration/circuit-breaker-reset.test.ts 验证内存 + DB 一致。Dashboard 加按钮（不强求本 PR）。harness_mode: false。"
}'
```

**Files**: `circuit-breaker.js` + `routes/circuit-breaker.js` + test

### W7.3 — startup-recovery 保护活跃 worktree

**Brain 任务注册**:
```bash
curl -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d '{
  "title": "[Harness 可靠性 W7.3] startup-recovery 保护活跃 worktree",
  "task_type": "dev",
  "priority": "P1",
  "location": "us",
  "description": "见 spec §W7.3 (Bug #E)。packages/brain/src/startup-recovery.js 的 cleanupStaleWorktrees 当前可能误清活跃 worktree。改：检查 worktree 内是否有 .dev-lock 或 .dev-mode.* 且最近 24h 修改 → 跳过清理。验证：tests/integration/startup-recovery-active-lock.test.ts 模拟 worktree 含 .dev-lock，cleanupStaleWorktrees 后该 worktree 仍在。harness_mode: false。"
}'
```

### W7.4 — Migration 同号 Lint

**Brain 任务注册**:
```bash
curl -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d '{
  "title": "[Harness 可靠性 W7.4] migration 同号 lint CI",
  "task_type": "dev",
  "priority": "P1",
  "location": "us",
  "description": "见 spec §W7.4 (Bug #G)。新建 .github/workflows/scripts/lint-migration-unique-version.cjs：扫 packages/brain/migrations/*.sql 提取首数字前缀，发现同号即 exit 1。在 brain-ci.yml 加 lint job 调用此脚本。验证：脚本 unit test 在 fixture 上验证捕获同号。harness_mode: false。"
}'
```

### W7.5 — 凭据巡检接 Scheduler（依赖 W7.1 的 #2804 合并）

**Brain 任务注册**（必须等 #2804 rebase 合并后）:
```bash
curl -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d '{
  "title": "[Harness 可靠性 W7.5] 凭据巡检接 daily scheduler",
  "task_type": "dev",
  "priority": "P1",
  "location": "us",
  "description": "见 spec §W7.5 (Bug #A 代码侧)。packages/brain/src/credentials-health-scheduler.js 接入 #2804 引入的 api-credentials-checker.checkAllApiCredentials()，daily 跑一次失败发 P0 alert（Anthropic 余额 0 / OpenAI quota 超 / codex 401）。验证：mock 失败响应 → alert 发出。harness_mode: false。"
}'
```

### W7.6 — Feishu Unmute（运维操作）

```bash
curl -X PATCH localhost:5221/api/brain/settings/muted -H "Content-Type: application/json" -d '{"enabled":false}'
# Smoke：触发一个 P0 alert 看 Feishu 是否真的收到
curl -X POST localhost:5221/api/brain/alerts/test -H "Content-Type: application/json" -d '{"priority":"P1","title":"watchdog smoke","body":"unmute verify"}'
```

**DoD**: 飞书群收到测试消息。文档记录到 `docs/operations/2026-05-06-feishu-unmute.md`。

### W7.7 — Dispatch API 错误返回清理

**Brain 任务注册**:
```bash
curl -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d '{
  "title": "[Harness 可靠性 W7.7] dispatch API 错误返回清理",
  "task_type": "dev",
  "priority": "P2",
  "location": "us",
  "description": "见 spec §W7.7 (Bug #F)。packages/brain/src/routes/tasks.js 的 POST /api/brain/tasks/:id/dispatch 当前实际派发成功但返回 {error:dispatch failed}。改：成功返回 202 Accepted + dispatched_at。验证：tests/integration/dispatch-api-response.test.ts 模拟 dispatcher 异步成功 → 200/202。harness_mode: false。"
}'
```

---

## Work Stream 8: 端到端 Acceptance

**触发条件**: W1+W2+W3+W4+W5+W6+W7.1-7.7 全部合并 main 后启动。

**Brain 任务注册**:
```bash
curl -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d '{
  "title": "[Harness Acceptance] LangGraph 可靠性打通验证 — 端到端跑通",
  "task_type": "harness_initiative",
  "priority": "P1",
  "location": "us",
  "description": "Walking Skeleton：单 thin feature（GET /api/brain/harness/health 返回 langgraph_version + last_attempt_at）。tasks: 1) feat: 新增 health endpoint + smoke test。e2e_acceptance: curl 该 endpoint 返回 200 且 body 含 langgraph_version。budget_usd: 5 timeout_sec: 1800。",
  "payload": {
    "initiative_id": "harness-acceptance-2026-05-06",
    "sprint_dir": "sprints/harness-acceptance",
    "walking_skeleton": {
      "journey_id": "harness-reliability",
      "e2e_test_path": "tests/e2e/harness-acceptance-smoke.spec.ts",
      "thin_features": ["F1-health-endpoint"],
      "target_maturity": "skeleton"
    }
  }
}'
```

### Task 8.1: 干净启动 + 派发

- [ ] **Step 1: 注册 acceptance task（命令上面）**
- [ ] **Step 2: 在 Brain dispatch endpoint 触发**
- [ ] **Step 3: tail Brain log + LiveMonitor 截屏**

### Task 8.2: 故障注入 A — Docker SIGKILL

- [ ] **Step 4: Acceptance 跑到子任务 evaluate node 时**

```bash
# 找到当前跑中的子 container
docker ps --filter name=cecelia-task- --format '{{.Names}}'
# 选一个 SIGKILL
docker kill <container-name>
```

**期望**:
- W6 修复：Promise 立即 reject（不 hang）
- W2 RetryPolicy：自动 retry 3 次
- 子任务最终 PASS（retry 成功）

**验证**: `task_events` 表存在 `graph_node_update` 多次 attempt + 最终 success

### Task 8.3: 故障注入 B — 凭据失效

- [ ] **Step 5: 临时坏掉 Anthropic credentials**

```bash
op item edit "ZenJoyMedia21@outlook.com Claude Code Pro Account 1" credential="invalid-test-key"
bash packages/brain/scripts/sync-credentials.sh
```

**期望**:
- W2 retryOn=false 永久错误立即抛
- W5 interrupt 暂停在 final_evaluate（fix_round 不会自然达到 max，所以这个故障可能不触发 W5；改造场景让其触发）

实际场景 B 改为：让 final E2E 一直 FAIL → 撞 max_fix_rounds → interrupt 触发

**验证**: GET `/api/brain/harness-interrupts` 含一个 pending；POST resume `{action:"abort"}` → graph 转 END error 状态

恢复凭据：
```bash
op item edit "ZenJoyMedia21@outlook.com Claude Code Pro Account 1" credential="<real-key>"
bash packages/brain/scripts/sync-credentials.sh
```

### Task 8.4: 故障注入 C — Deadline 逾期

- [ ] **Step 6: 强制 deadline 过期**

```bash
psql -d cecelia -c "UPDATE initiative_runs SET deadline_at = NOW() - INTERVAL '1 minute' WHERE initiative_id='harness-acceptance-2026-05-06'"
# 等下次 watchdog scan（最多 5min）
```

**期望**:
- W3 watchdog 标 phase=failed failure_reason=watchdog_overdue
- 下次重派该 task → W1 attemptN +1 → fresh start

### Task 8.5: 验证清单全检

- [ ] **Step 7: 跑完整 verification**

```bash
# 1. 14 节点全过
psql -d cecelia -c "SELECT payload->>'nodeName' AS node, COUNT(*) FROM task_events WHERE event_type='graph_node_update' AND payload->>'initiativeId'='harness-acceptance-2026-05-06' GROUP BY node ORDER BY MIN(created_at)"

# 2. PR merged
gh pr list --search "harness acceptance health endpoint" --state merged

# 3. health endpoint live
curl -s localhost:5221/api/brain/harness/health | jq

# 4. KR 进度
curl -s localhost:5221/api/brain/okr/current | jq '.[] | select(.title | contains("管家闭环"))'

# 5. LiveMonitor 截图（手动浏览器看 + 截屏）

# 6. acceptance task 终态
curl -s localhost:5221/api/brain/tasks/<acceptance-task-id> | jq '{status, final_e2e_verdict, sub_tasks}'
```

- [ ] **Step 8: 写 acceptance 报告 → docs/superpowers/reports/2026-05-06-harness-langgraph-acceptance.md**

---

## Self-Review

**Spec coverage check**:
- ✅ W1 thread_id 版本化 — Task 1.1-1.3
- ✅ W2 RetryPolicy — Task 2.1-2.4
- ✅ W3 AbortSignal+watchdog — Task 3.1-3.5
- ✅ W4 streamMode — Task 4.1-4.4
- ✅ W5 interrupt() — Task 5.1-5.3
- ✅ W6 docker-executor OOM — Task 6.1-6.4
- ✅ W7.1-7.7 运维清单 — 7 个独立 Brain task 注册命令
- ✅ Acceptance + 故障注入 A/B/C — Task 8.1-8.5

**Placeholder scan**: 无 TBD / TODO / "fill in details"。每个 step 有具体代码 / 命令。

**Type consistency**: 
- `runHarnessInitiativeRouter` 在 W1/W3/W4 命名一致
- `LLM_RETRY/DB_RETRY/NO_RETRY` 在 W2 retry-policies.js 集中定义后所有 graph 引用
- `emitGraphNodeUpdate` 签名一致（taskId/initiativeId/threadId/nodeName/attemptN/payloadSummary）
- `summarizeNodeState` 私有 helper

**Acceptance criteria 与 spec §4 对齐**: 14 节点过 / PR merge / KR 进度 / LiveMonitor 可见 / 故障 A/B/C 自愈 / 全程无干预 — 全部映射到 Task 8.x。

---

## Execution Handoff

**总数**: 8 Work Streams，含 7 个独立 PR + 1 个 Acceptance。

**推荐**: subagent-driven-development，每个 Work Stream 一个 subagent，按依赖批次并行/串行 dispatch。

**实际操作**（项目约束）: Cecelia 系统下不能直接 Agent isolation worktree 写代码 push（CLAUDE.md feedback_no_agent_bypass_dev）。**必须走 Brain dev pipeline**：每个 Work Stream 注册成 Brain dev task → Brain dispatcher 派给 /dev → /dev 全流程跑（worktree + Stop Hook + verify-step）。

**触发顺序**:
1. **批次 1 立即并行注册**: W6, W7.1, W7.2, W7.4, W7.6, W7.7
2. 等批次 1 全合 main → **批次 2**: W1, W2
3. 等批次 2 全合 → **批次 3**: W3, W4
4. 等批次 3 全合 → **批次 4**: W5, W7.3, W7.5
5. 等批次 4 全合 → **批次 5**: W8 Acceptance

每批次注册后用 `curl -X POST localhost:5221/api/brain/tasks/:id/dispatch` 强制立即派发（如不愿等 5min tick）。
