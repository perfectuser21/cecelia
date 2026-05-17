# C6 tick.js WORKFLOW_RUNTIME 灰度 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `tick.js` 加 `WORKFLOW_RUNTIME=v2` env gate，task_type=dev 时走 L2 `runWorkflow('dev-task')` fire-and-forget；默认 v1 走 legacy `triggerCeceliaRun`，生产零行为变化。

**Architecture:** `dispatchNextTask` 在 L1363 `triggerCeceliaRun` 之前加 env 判断分支；v2 分支自补 bookkeeping（`recordDispatchResult` / `emit` / `_lastDispatchTime`）；fire-and-forget `.catch` 用 `logTickDecision` 落盘。

**Tech Stack:** Node.js 20 ESM / vitest / `@langchain/langgraph` / pg checkpointer

---

## 文件结构

- Modify: `packages/brain/src/tick.js` — L1362-L1363 附近插 v2 分支（~30 行）
- Create: `packages/brain/src/__tests__/tick-workflow-runtime.test.js` — 5 cases（~180 行）
- Create: `docs/learnings/cp-0424155809-brain-v2-c6-tick-workflow-runtime.md` — Learning

## 前置验证（每次开工先确认）

```bash
# 已在 worktree（engine-worktree 建好）
pwd  # 应 /Users/administrator/worktrees/cecelia/brain-v2-c6-tick-workflow-runtime
git branch --show-current  # 应 cp-0424155809-brain-v2-c6-tick-workflow-runtime

# 依赖装好
test -d packages/brain/node_modules || (cd packages/brain && npm install)
```

---

### Task 1: 写失败测试文件（Red commit）

**Files:**
- Create: `packages/brain/src/__tests__/tick-workflow-runtime.test.js`

- [ ] **Step 1.1: 写 test 文件**

```javascript
/**
 * Brain v2 Phase C6: tick.js WORKFLOW_RUNTIME env gate 单测。
 *
 * 验证 task_type=dev 时：
 *  - env 未设 / v1 → legacy triggerCeceliaRun 被调
 *  - env=v2 → runWorkflow('dev-task', taskId, attemptN, {task}) 被调，triggerCeceliaRun 不调
 *  - attemptN 从 retry_count / payload.attempt_n 计算 +1
 *  - env=v2 但 task_type != dev → legacy 被调（flag 只影响 dev）
 *
 * 用 vi.hoisted() 建 mock（C2 learning：裸对象引 top-level 会被 vitest hoist 打爆）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  triggerCeceliaRun: vi.fn(),
  runWorkflow: vi.fn(),
  logTickDecision: vi.fn(),
  recordDispatchResult: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('../executor.js', () => ({
  triggerCeceliaRun: mocks.triggerCeceliaRun,
  checkCeceliaRunAvailable: vi.fn().mockResolvedValue({ available: true }),
  killProcess: vi.fn(),
  checkServerResources: vi.fn(),
  probeTaskLiveness: vi.fn(),
  killProcessTwoStage: vi.fn(),
  requeueTask: vi.fn(),
  MAX_SEATS: 2,
  INTERACTIVE_RESERVE: 0,
  getBillingPause: vi.fn().mockReturnValue({ active: false }),
}));

vi.mock('../orchestrator/graph-runtime.js', () => ({
  runWorkflow: mocks.runWorkflow,
}));

vi.mock('../dispatch-stats.js', () => ({
  recordDispatchResult: mocks.recordDispatchResult,
}));

vi.mock('../event-bus.js', () => ({
  emit: mocks.emit,
}));

describe('tick.js WORKFLOW_RUNTIME env gate (C6)', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env.WORKFLOW_RUNTIME;
    Object.values(mocks).forEach((m) => m.mockReset?.());
    mocks.triggerCeceliaRun.mockResolvedValue({ success: true, runId: 'legacy-run' });
    mocks.runWorkflow.mockResolvedValue({ result: { ok: true } });
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.WORKFLOW_RUNTIME;
    else process.env.WORKFLOW_RUNTIME = originalEnv;
  });

  it('env 未设 + task_type=dev → legacy triggerCeceliaRun 被调', async () => {
    delete process.env.WORKFLOW_RUNTIME;
    const { _dispatchViaWorkflowRuntime } = await import('../tick.js');
    const task = { id: 'task-aaa', task_type: 'dev', title: 'hello', retry_count: 0 };
    const result = await _dispatchViaWorkflowRuntime(task);
    expect(result).toEqual({ handled: false });
    expect(mocks.runWorkflow).not.toHaveBeenCalled();
  });

  it('env=v1 + task_type=dev → legacy 被调（显式 v1）', async () => {
    process.env.WORKFLOW_RUNTIME = 'v1';
    const { _dispatchViaWorkflowRuntime } = await import('../tick.js');
    const task = { id: 'task-bbb', task_type: 'dev', title: 'hello', retry_count: 0 };
    const result = await _dispatchViaWorkflowRuntime(task);
    expect(result).toEqual({ handled: false });
    expect(mocks.runWorkflow).not.toHaveBeenCalled();
  });

  it('env=v2 + task_type=dev → runWorkflow 被调 fire-and-forget，attemptN=1', async () => {
    process.env.WORKFLOW_RUNTIME = 'v2';
    const { _dispatchViaWorkflowRuntime } = await import('../tick.js');
    const task = { id: 'task-ccc', task_type: 'dev', title: 'v2-smoke', retry_count: 0 };
    const result = await _dispatchViaWorkflowRuntime(task);
    expect(result.handled).toBe(true);
    expect(result.runtime).toBe('v2');
    expect(mocks.runWorkflow).toHaveBeenCalledTimes(1);
    expect(mocks.runWorkflow).toHaveBeenCalledWith(
      'dev-task',
      'task-ccc',
      1,
      { task },
    );
    expect(mocks.triggerCeceliaRun).not.toHaveBeenCalled();
    expect(mocks.recordDispatchResult).toHaveBeenCalledWith(expect.anything(), true, 'workflow_runtime_v2');
    expect(mocks.emit).toHaveBeenCalledWith(
      'task_dispatched',
      'tick',
      expect.objectContaining({ task_id: 'task-ccc', runtime: 'v2', success: true }),
    );
  });

  it('env=v2 + task_type=dev + retry_count=2 → attemptN=3', async () => {
    process.env.WORKFLOW_RUNTIME = 'v2';
    const { _dispatchViaWorkflowRuntime } = await import('../tick.js');
    const task = { id: 'task-ddd', task_type: 'dev', title: 'retry', retry_count: 2 };
    await _dispatchViaWorkflowRuntime(task);
    expect(mocks.runWorkflow).toHaveBeenCalledWith(
      'dev-task',
      'task-ddd',
      3,
      { task },
    );
  });

  it('env=v2 + task_type=harness_initiative → legacy 被调（flag 仅影响 dev）', async () => {
    process.env.WORKFLOW_RUNTIME = 'v2';
    const { _dispatchViaWorkflowRuntime } = await import('../tick.js');
    const task = { id: 'task-eee', task_type: 'harness_initiative', title: 'harness', retry_count: 0 };
    const result = await _dispatchViaWorkflowRuntime(task);
    expect(result).toEqual({ handled: false });
    expect(mocks.runWorkflow).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 1.2: 运行测试，确认全 fail**

```bash
cd packages/brain && npm test -- tick-workflow-runtime 2>&1 | tail -30
```

Expected: FAIL — `_dispatchViaWorkflowRuntime` 未从 tick.js 导出。

- [ ] **Step 1.3: Commit Red**

```bash
cd /Users/administrator/worktrees/cecelia/brain-v2-c6-tick-workflow-runtime
git add packages/brain/src/__tests__/tick-workflow-runtime.test.js
git commit -m "test(brain): C6 tick-workflow-runtime failing tests (Red)

5 cases 覆盖 WORKFLOW_RUNTIME env gate:
- env 未设 / v1 → legacy triggerCeceliaRun
- env=v2 + task_type=dev → runWorkflow(dev-task, taskId, attemptN, {task})
- retry_count=2 → attemptN=3
- env=v2 + task_type!=dev → legacy

vi.hoisted() mock 避 C2 learning top-level 打爆。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 实现 tick.js v2 分支（Green commit）

**Files:**
- Modify: `packages/brain/src/tick.js` — 文件末尾（export 区域）增加 `_dispatchViaWorkflowRuntime`；`dispatchNextTask` L1362 之后 L1363 之前插入调用

**策略**：把 v2 分派逻辑抽成独立 export 函数 `_dispatchViaWorkflowRuntime(taskToDispatch)`，返回 `{handled: true, runtime: 'v2', ...}` 或 `{handled: false}`。`dispatchNextTask` 调它，handled 时 return dispatched=true；否则 fall-through 到原 legacy 路径。这样测试能单独 import 此函数，不需要 mock 整个 dispatchNextTask 的前置 20 步。

- [ ] **Step 2.1: 在 tick.js 文件末尾 export `_dispatchViaWorkflowRuntime`**

在 tick.js 最后一个 export 之后添加：

```javascript
// ═══════════════════════════════════════════════════════════════════════════
// C6: Brain v2 WORKFLOW_RUNTIME env gate
// ═══════════════════════════════════════════════════════════════════════════

/**
 * C6: WORKFLOW_RUNTIME=v2 + task_type=dev 时，通过 L2 orchestrator runWorkflow('dev-task')
 * 派发 fire-and-forget；否则返回 {handled:false} 让 caller fall through 到 legacy
 * triggerCeceliaRun 路径。
 *
 * 默认（env 未设 / v1）返回 handled:false，生产零行为变化。
 *
 * @param {object} taskToDispatch Brain task row（含 id / task_type / retry_count 等）
 * @returns {Promise<{handled:boolean, runtime?:string, task_id?:string, actions?:Array}>}
 */
export async function _dispatchViaWorkflowRuntime(taskToDispatch) {
  if (process.env.WORKFLOW_RUNTIME !== 'v2') return { handled: false };
  if (taskToDispatch?.task_type !== 'dev') return { handled: false };

  const { runWorkflow } = await import('./orchestrator/graph-runtime.js');
  const attemptN = (taskToDispatch.payload?.attempt_n ?? taskToDispatch.retry_count ?? 0) + 1;

  // fire-and-forget：graph 层 pg checkpointer 负责崩溃 resume；.catch 落 logTickDecision 排障
  runWorkflow('dev-task', taskToDispatch.id, attemptN, { task: taskToDispatch })
    .catch((err) => {
      logTickDecision(
        'tick',
        `runWorkflow dev-task failed: ${err.message}`,
        {
          action: 'workflow_runtime_error',
          task_id: taskToDispatch.id,
          runtime: 'v2',
          attemptN,
          error: err.message,
        },
        { success: false },
      );
    });

  _lastDispatchTime = Date.now();
  await recordDispatchResult(pool, true, 'workflow_runtime_v2');
  await emit('task_dispatched', 'tick', {
    task_id: taskToDispatch.id,
    title: taskToDispatch.title,
    runtime: 'v2',
    success: true,
  });

  const actions = [{
    action: 'dispatch_v2_workflow',
    task_id: taskToDispatch.id,
    runtime: 'v2',
    attemptN,
  }];

  return { handled: true, runtime: 'v2', task_id: taskToDispatch.id, actions };
}
```

- [ ] **Step 2.2: 在 `dispatchNextTask` L1362 和 L1363 之间插入 v2 gate 调用**

找到 `packages/brain/src/tick.js` 里的：

```javascript
  } catch (err) {
    console.warn(`[dispatch] shouldDowngrade check failed: ${err.message}, proceeding with original executor`);
  }

  const execResult = await triggerCeceliaRun(taskToDispatch);
```

改成：

```javascript
  } catch (err) {
    console.warn(`[dispatch] shouldDowngrade check failed: ${err.message}, proceeding with original executor`);
  }

  // C6: Brain v2 WORKFLOW_RUNTIME=v2 + task_type=dev → runWorkflow 接线（fire-and-forget）
  const v2Result = await _dispatchViaWorkflowRuntime(taskToDispatch);
  if (v2Result.handled) {
    return {
      dispatched: true,
      task_id: v2Result.task_id,
      runtime: 'v2',
      actions: [...actions, ...v2Result.actions],
    };
  }

  const execResult = await triggerCeceliaRun(taskToDispatch);
```

- [ ] **Step 2.3: 运行新测试，确认 5 cases 全绿**

```bash
cd packages/brain && npm test -- tick-workflow-runtime 2>&1 | tail -30
```

Expected: PASS — 5/5 tests pass。

- [ ] **Step 2.4: 运行所有 tick 相关测试，确认不退化**

```bash
cd packages/brain && npm test -- tick 2>&1 | tail -40
```

Expected: 所有 tick.test.js / tick-*.test.js 全绿（含新加的 tick-workflow-runtime）。

- [ ] **Step 2.5: Commit Green**

```bash
cd /Users/administrator/worktrees/cecelia/brain-v2-c6-tick-workflow-runtime
git add packages/brain/src/tick.js
git commit -m "feat(brain): C6 tick.js WORKFLOW_RUNTIME=v2 + dev-task runWorkflow 接线 (Green)

dispatchNextTask 在 triggerCeceliaRun 之前加 _dispatchViaWorkflowRuntime gate：
- env 未设 / v1 → 返回 {handled:false} fall-through legacy（生产零变化）
- env=v2 + task_type=dev → fire-and-forget runWorkflow('dev-task', taskId, attemptN, {task})
- .catch 写入 logTickDecision (decisions 表) 避免静默
- 补 bookkeeping: _lastDispatchTime / recordDispatchResult / emit('task_dispatched') / actions

解除 C2 守门条件（tick.js 首次含 runWorkflow 调用）。

Brain task: 4262fa62-c072-43f5-a818-90c00a55f0a8

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 写 Learning 文件

**Files:**
- Create: `docs/learnings/cp-0424155809-brain-v2-c6-tick-workflow-runtime.md`

- [ ] **Step 3.1: 写 Learning**

```markdown
# C6 tick.js WORKFLOW_RUNTIME 灰度 Learning

## 背景
Brain v2 Phase C6 —— tick.js 首次接线 L2 orchestrator `runWorkflow('dev-task')`，加 `WORKFLOW_RUNTIME=v2` env gate 灰度切换。C2 审查时守门条件"tick.js 零 runWorkflow 调用"在本 PR 解除。

## 根本原因
C1-C5 完成后 Brain container 跑的是旧 image 不含 workflows/ 目录，C6 开工前必须先 `bash scripts/brain-deploy.sh` 把新 image 部署。若跳过 deploy，v2 flag 生效后 `getWorkflow('dev-task')` 会报 "workflow not found"，fire-and-forget `.catch` 静默吞错误，生产任务积压无提示。

handoff §4 原 code snippet 写 `runWorkflow('dev-task', task.id, attemptN, task)` 参数 `task`，但 `DevTaskState` 字段是 `{task, result, error}`，`runAgentNode` 读 `state.task`，所以正确入参必须包装为 `{task: taskToDispatch}`。

fire-and-forget `.catch(err => console.error)` 错误落 stdout 被 docker log rotation 滚掉，c6a 合并后 24h 观察窗口无法排障。改用 `logTickDecision` 写入 decisions 表，CI 可以 grep `action='workflow_runtime_error'` 定位。

## 下次预防

- [ ] Brain deploy 冒烟：手动 set `WORKFLOW_RUNTIME=v2` 前先验证 `docker exec cecelia-node-brain ls /app/src/workflows/` 有输出、`docker logs | grep "Workflows initialized"` 存在
- [ ] runWorkflow 接入任何 workflow 时，确认 input 结构与目标 graph StateGraph Annotation.Root 字段名一致（读 `<name>.graph.js` 的 `export const XxxState = Annotation.Root({...})`）
- [ ] fire-and-forget graph 调用的 `.catch` 必须走 `logTickDecision` 或 `recordDispatchResult(false, 'reason')` 落库，不可仅 `console.error`
- [ ] v2 分支补齐 bookkeeping（`_lastDispatchTime` / `recordDispatchResult` / `emit('task_dispatched')`），否则 capacity budget / dashboard WS / dispatch stats 静默断裂
- [ ] vitest mock 使用 `vi.hoisted()` 而非裸对象引 top-level（C2 learning）
- [ ] Manual smoke 验证 checkpoint resume：中途 kill Brain → restart → `psql SELECT thread_id, COUNT(*) FROM checkpoints WHERE thread_id LIKE '<task_id>:%' GROUP BY thread_id` 返回 rows > 0

## 相关
- PR: 本 PR
- Handoff: `docs/design/brain-v2-c6-handoff.md`
- Design: `docs/superpowers/specs/2026-04-24-c6-workflow-runtime-flag-design.md`
- Spec SSOT: `docs/design/brain-orchestrator-v2.md` §6 + §12
```

- [ ] **Step 3.2: Commit Learning**

```bash
cd /Users/administrator/worktrees/cecelia/brain-v2-c6-tick-workflow-runtime
git add docs/learnings/cp-0424155809-brain-v2-c6-tick-workflow-runtime.md
git commit -m "docs(learnings): C6 tick WORKFLOW_RUNTIME 灰度 learning

根本原因 + 下次预防 checklist（Brain deploy 冒烟 / input 结构匹配 / .catch 落库 / bookkeeping / vi.hoisted / checkpoint resume 验证）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- Design §3.1 bookkeeping 补齐 → Task 2 Step 2.1 已写入 `_lastDispatchTime` / `recordDispatchResult('workflow_runtime_v2')` / `emit` / `actions` ✅
- Design §3.2 input `{task}` → Task 1 Step 1.1 test case 3 断言 `{task}` + Task 2 Step 2.1 入参 `{task: taskToDispatch}` ✅
- Design §3.3 attemptN 计算 → Task 1 case 4 `retry_count=2 → attemptN=3` + Task 2 Step 2.1 `(payload?.attempt_n ?? retry_count ?? 0) + 1` ✅
- Design §3.4 logTickDecision 落库 → Task 2 Step 2.1 `.catch` 内调用 ✅
- Design §4 5 cases 单测 → Task 1 5 cases ✅
- Design §5 成功标准：env 未设零行为变化 → Task 1 cases 1&2 覆盖 + Task 2 早 return ✅
- Design §9 Learning 文件 → Task 3 已覆盖 ✅

**2. Placeholder scan:** 无 TBD / TODO / "similar to" 占位。所有代码块含完整实现。

**3. Type consistency:**
- `_dispatchViaWorkflowRuntime` 返回 `{handled, runtime?, task_id?, actions?}` — Task 1 test 断言 `.handled` / `.runtime`，Task 2 `dispatchNextTask` caller 读 `v2Result.handled` / `v2Result.task_id` / `v2Result.actions` ✅
- `runWorkflow` 签名 `(workflowName, taskId, attemptN, input)` — Task 1 expect + Task 2 调用一致 ✅
- `{task: taskToDispatch}` vs `{task}` — test 用 `{task}`（解构等价），impl 用 `{task: taskToDispatch}`（显式）—— Vitest 字段匹配，OK。但为显式保持一致，test 也用 `{task}`（JS shorthand）。

无需 fix。

---

## 执行方式

按 /dev autonomous Tier 1 默认：**subagent-driven-development**（每 Task 一 subagent，两阶段 review）。
