# 秋米任务豁免 cecelia-run 熔断 + 路由幂等 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** qiumi_task（openclaw-agent 表面）不再被 cecelia-run 熔断 / bridge 健康检查误伤；每 tick 不再重复路由；openclaw 失败计入自己的熔断键。

**Architecture:** 只动 `packages/brain/src/dispatcher.js` 四处：① `needsBridgeCheck` 按注册表 surface 派生豁免；② `routeAndPersistQiumi` 入口前置 `isAllowed('openclaw-agent')`；③ 全行 payload 已有 `qiumi_route`+`run_id` 时直接 proceed；④ 熔断计数按 surface 分键（`recordFailure/recordSuccess('openclaw-agent')`）。测试全部落在既有 `src/__tests__/dispatcher-qiumi-routing.test.js`。

**Tech Stack:** Node ESM、vitest、既有 `lib/task-type-registry.js`（`getTaskType(type).surface`）、`circuit-breaker.js`（`isAllowed/recordFailure/recordSuccess`）。

## Global Constraints
- 不手抄任务类型名单：豁免判据只能是 `getTaskType(type)?.surface === 'openclaw-agent'`（铁律 76cb816c）。
- 不改 `circuit-breaker.js`；新熔断键 `'openclaw-agent'` 由其内存/DB 自动创建。
- NO PRODUCTION CODE WITHOUT FAILING TEST FIRST：每 Task commit-1 只含测试且红，commit-2 实现转绿；commit 结尾 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。
- 测试命令固定：`cd packages/brain && npx vitest run src/__tests__/dispatcher-qiumi-routing.test.js src/__tests__/dispatcher-device-lock.test.js src/__tests__/dispatch-preflight-skip.test.js`（禁全量）。
- 每 Task 做变异验证（还原实现 → 用例红 → 再还原绿），证据写进 commit-2 body。
- `git add` 只按文件名；不提交 `.superpowers/`、`sprints/`。

---

### Task 0: 测试文件把 circuit-breaker mock 改成可控（不改实现，属测试基建）

**Files:**
- Modify: `packages/brain/src/__tests__/dispatcher-qiumi-routing.test.js:74`

- [ ] **Step 1: 把固定 mock 改成可控 mock**

把第 74 行
```js
vi.mock('../circuit-breaker.js', () => ({ isAllowed: () => true, recordFailure: vi.fn(async () => {}) }));
```
改为（放在同一位置）：
```js
const mockIsAllowed = vi.fn(() => true);
const mockRecordFailure = vi.fn(async () => {});
const mockRecordSuccess = vi.fn(async () => {});
vi.mock('../circuit-breaker.js', () => ({
  isAllowed: (k) => mockIsAllowed(k),
  recordFailure: (...a) => mockRecordFailure(...a),
  recordSuccess: (...a) => mockRecordSuccess(...a),
}));
```
并在 `beforeEach` 里追加一行 `mockIsAllowed.mockImplementation(() => true);`。
在 `import { dispatchQiumiTask, dispatchNextTask } from '../dispatcher.js';` 之前追加：
```js
import { checkCeceliaRunAvailable } from '../executor.js';
```

- [ ] **Step 2: 跑测试确认既有用例仍全绿**（这是重构 mock，不许改变行为）
Run: `cd packages/brain && npx vitest run src/__tests__/dispatcher-qiumi-routing.test.js`
Expected: 全绿（与改前同数）。

- [ ] **Step 3: commit**
```bash
git add packages/brain/src/__tests__/dispatcher-qiumi-routing.test.js
git commit -m "test(brain): dispatcher-qiumi 测试把 circuit-breaker mock 改成可控（为熔断豁免用例铺路）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 1: `needsBridgeCheck` 按注册表 surface 豁免 openclaw-agent

**Files:**
- Modify: `packages/brain/src/dispatcher.js:8`（import）、`:955`（needsBridgeCheck）
- Test: `packages/brain/src/__tests__/dispatcher-qiumi-routing.test.js`

**Interfaces:**
- Produces：模块内 helper `isOpenclawSurface(type)`（Task 4 复用）。

- [ ] **Step 1: 写失败测试**（追加到文件末尾）

```js
describe('熔断豁免：qiumi_task 走 ssh 直派，不受 cecelia-run 熔断与 bridge 健康检查约束', () => {
  it('cecelia-run 熔断 OPEN 时 qiumi 仍走到 triggerCeceliaRun，且不查 bridge、不回滚 queued', async () => {
    _candidatePool = [candidate];
    wireQueries();
    routeQiumiTask.mockResolvedValue({ outcome: 'agent', model: 'm', runId: 'r1', payloadPatch: {} });
    mockIsAllowed.mockImplementation((k) => k !== 'cecelia-run');

    const r = await dispatchNextTask(null);

    expect(mockTriggerCeceliaRun, 'qiumi 被 cecelia-run 熔断挡住了——它根本不走 bridge').toHaveBeenCalledTimes(1);
    expect(checkCeceliaRunAvailable).not.toHaveBeenCalled();
    expect(mockUpdateTask).not.toHaveBeenCalledWith({ task_id: 'q1', status: 'queued' });
    expect(r).toMatchObject({ dispatched: true, task_id: 'q1' });
  });
});
```

> 若 `dispatchNextTask` 在 `triggerCeceliaRun` 之前因 `enforceDispatchRoutingReceipt`（对 fixture 无路由回执）抛错或早退，在文件顶部 mock 它所在模块为 no-op：先 `grep -n "enforceDispatchRoutingReceipt" packages/brain/src/dispatcher.js` 找到 import 路径 `<mod>`，加 `vi.mock('<mod>', () => ({ enforceDispatchRoutingReceipt: vi.fn(async () => {}) }));`。若成功后续（`recordTaskEventSafe`/`publishTaskStarted`）报错，同法 mock `../lib/task-event-log.js` 为 `{ recordTaskEventSafe: vi.fn(async () => true) }`。这些都是本用例的环境噪声，不是被测行为。

- [ ] **Step 2: 跑测试确认失败**
Run: `cd packages/brain && npx vitest run src/__tests__/dispatcher-qiumi-routing.test.js -t "cecelia-run 熔断 OPEN"`
Expected: FAIL —— `mockTriggerCeceliaRun` 0 次（任务被 `circuit_breaker_open` 打回 queued）。

- [ ] **Step 3: commit-1**
```bash
git add packages/brain/src/__tests__/dispatcher-qiumi-routing.test.js
git commit -m "test(brain): cecelia-run 熔断 OPEN 时 qiumi_task 仍应派发且不查 bridge（先红）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: 实现**

`packages/brain/src/dispatcher.js:8` 改为：
```js
import { INITIATIVE_LOCK_TASK_TYPES, RETIRED_HARNESS_TYPES_DISPATCH, HARNESS_INFLIGHT_TASK_TYPES, getTaskType } from './lib/task-type-registry.js';
```
在 import 区之后（`dispatchQiumiTask` 定义之前）加 helper：
```js
/**
 * openclaw-agent 表面（qiumi_task）由 Brain 经 ssh 直派 MMV，不经 cecelia-bridge：
 * cecelia-run 熔断与 bridge 健康检查对它都是误伤（2026-09-23 生产实证 task 72b010e9）。
 * 判据只从注册表 surface 派生，不手抄名单（铁律 76cb816c）。
 */
const isOpenclawSurface = (type) => getTaskType(type)?.surface === 'openclaw-agent';
```
`:955` 改为：
```js
  const needsBridgeCheck = !HARNESS_INFLIGHT_TASK_TYPES.includes(nextTask.task_type)
    && !isOpenclawSurface(nextTask.task_type);
```

- [ ] **Step 5: 跑测试转绿 + 变异**
Run: 固定测试命令。Expected: 全绿。
变异：把 `&& !isOpenclawSurface(...)` 临时删掉 → 本用例红；还原绿。

- [ ] **Step 6: commit-2**
```bash
git add packages/brain/src/dispatcher.js
git commit -m "fix(brain): openclaw-agent 表面豁免 cecelia-run 熔断与 bridge 健康检查——qiumi 走 ssh 直派不经 bridge

变异：删掉 surface 豁免 → 用例红；还原绿。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `dispatchQiumiTask` 入口前置独立熔断键 `openclaw-agent`

**Files:**
- Modify: `packages/brain/src/dispatcher.js`（`routeAndPersistQiumi` 开头，:276-287）
- Test: `packages/brain/src/__tests__/dispatcher-qiumi-routing.test.js`

- [ ] **Step 1: 写失败测试**（追加到 `describe('dispatchQiumiTask：三态出口')` 内末尾）

```js
  it('openclaw-agent 自己的熔断 OPEN → outcome=skip，释放 claim、记 openclaw_agent_circuit_open，不路由', async () => {
    wireQueries();
    mockIsAllowed.mockImplementation((k) => k !== 'openclaw-agent');
    const holSkipIds = [];

    const r = await dispatchQiumiTask(candidate, { actions: [], holSkipIds });

    expect(r).toEqual({ outcome: 'skip' });
    expect(routeQiumiTask, '熔断开着还去打 Jev').not.toHaveBeenCalled();
    expect(sqlsOf().some((s) => /claimed_by = NULL/.test(s))).toBe(true);
    expect(recordDispatchResult).toHaveBeenCalledWith(expect.anything(), false, 'openclaw_agent_circuit_open', undefined, 'q1');
    expect(holSkipIds).toContain('q1');
    expect(mockIsAllowed).toHaveBeenCalledWith('openclaw-agent');
  });
```

- [ ] **Step 2: 跑测试确认失败**
Run: `cd packages/brain && npx vitest run src/__tests__/dispatcher-qiumi-routing.test.js -t "openclaw-agent 自己的熔断"`
Expected: FAIL（现在会照常路由，`routeQiumiTask` 被调用 / outcome 不是 skip）。

- [ ] **Step 3: commit-1**
```bash
git add packages/brain/src/__tests__/dispatcher-qiumi-routing.test.js
git commit -m "test(brain): openclaw-agent 熔断 OPEN 时 qiumi 出口应 skip 且不路由（先红）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: 实现**

把 `routeAndPersistQiumi` 开头改成（`releaseClaim` 定义上移到读全行之前，其余保持）：
```js
async function routeAndPersistQiumi(task, deps = {}) {
  const env = deps.env ?? qiumiEnv();
  const actions = deps.actions ?? [];
  const holSkipIds = deps.holSkipIds ?? [];

  const releaseClaim = () => pool.query(
    'UPDATE tasks SET claimed_by = NULL, claimed_at = NULL, updated_at = NOW() WHERE id = $1',
    [task.id],
  );

  // openclaw-agent 有自己的熔断（MMV 起 agent 连败时才开），与 cecelia-run（bridge）互不牵连。
  // 放在最前面：熔断开着就别读全行、别打 Jev、别写 run_id——每 tick 白路由一次就是本刀要修的病。
  if (!isAllowed('openclaw-agent')) {
    await releaseClaim();
    await recordDispatchResult(pool, false, 'openclaw_agent_circuit_open', undefined, task.id);
    tickLog(`[dispatch] HOL skip: openclaw-agent breaker open, skipping qiumi task ${task.id}`);
    holSkipIds.push(task.id);
    return { outcome: 'skip' };
  }

  // 选单 SQL 只取部分列，便宜闸要读 payload.qiumi_source → 先把整行捞回来
  const fullRow = await pool.query('SELECT * FROM tasks WHERE id = $1', [task.id]);
  const fullTask = fullRow.rows[0] ?? task;
```
（删除原来位于读全行之后的那份 `releaseClaim` 定义，避免重复。）

- [ ] **Step 5: 跑测试转绿 + 变异**
Run: 固定测试命令。Expected: 全绿。变异：删掉 `if (!isAllowed('openclaw-agent'))` 块 → 用例红；还原绿。

- [ ] **Step 6: commit-2**
```bash
git add packages/brain/src/dispatcher.js
git commit -m "fix(brain): qiumi 出口前置 openclaw-agent 独立熔断——OPEN 即释放 claim 让位，不路由不打 Jev

变异：删前置检查 → 用例红；还原绿。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 路由幂等——payload 已有 `qiumi_route`+`run_id` 直接 proceed

**Files:**
- Modify: `packages/brain/src/dispatcher.js`（`routeAndPersistQiumi`，并发闸之后、`routeQiumiTask` 调用之前）
- Test: `packages/brain/src/__tests__/dispatcher-qiumi-routing.test.js`

- [ ] **Step 1: 写失败测试**（追加到 `describe('dispatchQiumiTask：三态出口')` 内末尾）

```js
  it('payload 已有 qiumi_route + run_id（上轮路由过、spawn 前被打回）→ 不再打 Jev，直接 proceed', async () => {
    const routedRow = { ...fullRow, payload: { ...fullRow.payload, run_id: 'qiumi-q1-1', model: 'openai/gpt-5.6-terra', qiumi_route: { source: 'jev', decided_at: '2026-09-23T03:48:25.000Z' } } };
    mockQuery.mockImplementation(async (sql) => {
      if (/SELECT \* FROM tasks WHERE id = \$1/.test(sql)) return { rows: [routedRow] };
      if (/count\(\*\)::int AS n FROM tasks/.test(sql) && /openclaw-agent/.test(sql)) return { rows: [{ n: 0 }] };
      return { rows: [] };
    });

    const r = await dispatchQiumiTask(candidate, { actions: [], holSkipIds: [] });

    expect(r).toEqual({ outcome: 'proceed' });
    expect(routeQiumiTask, '已有决策还去打 Jev——每 tick 生成新 run_id 就是这么来的').not.toHaveBeenCalled();
    expect(persistDecision).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: 跑测试确认失败**
Run: `cd packages/brain && npx vitest run src/__tests__/dispatcher-qiumi-routing.test.js -t "payload 已有 qiumi_route"`
Expected: FAIL（`routeQiumiTask` 被调用；因 mock 返回 undefined，`persistDecision`/`decision.outcome` 路径报错或 outcome 不对）。

- [ ] **Step 3: commit-1**
```bash
git add packages/brain/src/__tests__/dispatcher-qiumi-routing.test.js
git commit -m "test(brain): qiumi 任务已有路由决策时不得重复打 Jev（先红）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: 实现**（放在并发闸 `if ((rows[0]?.n ?? 0) >= env.mmvConcurrency) {...}` 块之后、`const decision = await routeQiumiTask(` 之前）

```js
  // 路由幂等：上一 tick 已判定并写了 run_id/model/qiumi_route，只是 spawn 前被打回 queued
  // （历史上是 cecelia-run 熔断，见本刀 Task 1）。决策不变就不重打 Jev、不换 run_id——
  // 执行体的 ALREADY 探针按 run_id 防重起，换了 run_id 它就认不出上一轮可能已起的 agent。
  if (fullTask.payload?.qiumi_route && fullTask.payload?.run_id) {
    tickLog(`[dispatch] qiumi task ${task.id} 已有路由决策 run_id=${fullTask.payload.run_id}，跳过 Jev 直接派发`);
    return { outcome: 'proceed' };
  }
```

- [ ] **Step 5: 跑测试转绿 + 变异**
Run: 固定测试命令。Expected: 全绿（既有 agent/device/fail 用例的 fixture 无 `run_id`，不受影响）。变异：删幂等块 → 用例红；还原绿。

- [ ] **Step 6: commit-2**
```bash
git add packages/brain/src/dispatcher.js
git commit -m "fix(brain): qiumi 路由幂等——payload 已有 qiumi_route+run_id 时直接 proceed，不重打 Jev 不换 run_id

变异：删幂等分支 → 用例红；还原绿。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 熔断计数按 surface 分键（openclaw 失败/成功记 `openclaw-agent`，不动 cecelia-run）

**Files:**
- Modify: `packages/brain/src/dispatcher.js:10`（import 加 `recordSuccess`）、`:1205`（recordFailure 分键）、5a 失败块之后（成功计数）
- Test: `packages/brain/src/__tests__/dispatcher-qiumi-routing.test.js`

- [ ] **Step 1: 写失败测试**（追加到 Task 1 的 `describe('熔断豁免…')` 内末尾）

```js
  it('openclaw 起 agent 失败 → recordFailure("openclaw-agent")，绝不计 cecelia-run', async () => {
    _candidatePool = [candidate];
    wireQueries();
    routeQiumiTask.mockResolvedValue({ outcome: 'agent', model: 'm', runId: 'r1', payloadPatch: {} });
    mockTriggerCeceliaRun.mockResolvedValue({ success: false, reason: 'openclaw_agent_spawn_failed', error: 'ssh timeout' });

    const r = await dispatchNextTask(null);

    expect(r).toMatchObject({ dispatched: false, reason: 'executor_failed', task_id: 'q1' });
    expect(mockRecordFailure).toHaveBeenCalledWith('openclaw-agent');
    expect(mockRecordFailure).not.toHaveBeenCalledWith('cecelia-run');
  });

  it('openclaw 起 agent 成功 → recordSuccess("openclaw-agent")', async () => {
    _candidatePool = [candidate];
    wireQueries();
    routeQiumiTask.mockResolvedValue({ outcome: 'agent', model: 'm', runId: 'r1', payloadPatch: {} });
    mockTriggerCeceliaRun.mockResolvedValue({ success: true, taskId: 'q1', runId: 'qiumi-q1-1', executor: 'openclaw-agent' });

    const r = await dispatchNextTask(null);

    expect(r).toMatchObject({ dispatched: true, task_id: 'q1' });
    expect(mockRecordSuccess).toHaveBeenCalledWith('openclaw-agent');
  });
```

- [ ] **Step 2: 跑测试确认失败**
Run: `cd packages/brain && npx vitest run src/__tests__/dispatcher-qiumi-routing.test.js -t "openclaw 起 agent"`
Expected: 两条 FAIL（现在失败记 `cecelia-run`；成功不记任何键）。

- [ ] **Step 3: commit-1**
```bash
git add packages/brain/src/__tests__/dispatcher-qiumi-routing.test.js
git commit -m "test(brain): openclaw 路径的熔断计数应记 openclaw-agent 键（先红）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: 实现**

`:10` 改为：
```js
import { isAllowed, recordFailure, recordSuccess } from './circuit-breaker.js';
```
`:1205`（失败块里 `await recordFailure('cecelia-run');`）改为：
```js
      await recordFailure(isOpenclawSurface(nextTask.task_type) ? 'openclaw-agent' : 'cecelia-run');
```
（其上方三条 configError / spawn_deduplicated / local_execution_disabled_on_scheduler 的跳过分支保持原样。）
在 5a 失败块 `if (!execResult.success) { ... }` 的闭合 `}` 之后、`} catch (err) { return await postClaimException(err); }` 之前追加：
```js
  // openclaw-agent 成功：给它自己的熔断记一笔成功（HALF_OPEN → CLOSED），与 cecelia-run 互不牵连
  if (isOpenclawSurface(nextTask.task_type)) {
    await recordSuccess('openclaw-agent');
  }
```

- [ ] **Step 5: 跑测试转绿 + 变异**
Run: 固定测试命令。Expected: 全绿。变异：把分键改回固定 `'cecelia-run'` → 失败用例红；删 `recordSuccess` 块 → 成功用例红；还原绿。

- [ ] **Step 6: commit-2**
```bash
git add packages/brain/src/dispatcher.js
git commit -m "fix(brain): 熔断计数按注册表 surface 分键——openclaw 失败/成功只记 openclaw-agent，不再污染 cecelia-run

变异：分键改回 cecelia-run → 红；删 recordSuccess → 红；还原绿。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 自审
- spec §1 ①②③④ ↔ Task 1/2/3/4 一一对应；spec §5 四条 unit 用例全部有代码；变异每 Task 有。
- 名字一致：`isOpenclawSurface`（Task 1 定义，Task 4 复用）、`mockIsAllowed/mockRecordFailure/mockRecordSuccess`（Task 0 定义，后续复用）、reason 字符串 `openclaw_agent_circuit_open`、熔断键 `'openclaw-agent'`。
- 无 TBD；每步有命令与期望。
- 版本 bump（brain-version-bump-gate）与 DEFINITION.md 同步由 finishing 阶段处理：`cd packages/brain && npm version patch --no-git-tag-version`（main 现 1.315.0 → 1.315.1）并同步 `DEFINITION.md` 的 Brain 版本行与两个 lockfile；不在本计划的 Task 内。
- `lint-feature-has-smoke`：本 PR commit 前缀为 `fix:`，不触发新 smoke 要求。
