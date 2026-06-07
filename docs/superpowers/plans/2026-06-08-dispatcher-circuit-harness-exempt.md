# dispatcher 熔断检查豁免 harness_initiative Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 dispatcher.js 全局熔断检查误拦截 harness_initiative 任务的 bug，使熔断器仅对依赖 cecelia-bridge 的任务生效。

**Architecture:** 删除 line 296-300 的提前全局检查，将熔断判断移至 line 536（`needsBridgeCheck` 已确定之后），复用相同的豁免条件。

**Tech Stack:** Node.js, Vitest, Brain dispatcher

---

### Task 1: 写三个 failing regression tests

**Files:**
- Create: `packages/brain/src/__tests__/dispatcher-circuit-harness-exempt.test.js`

- [ ] **Step 1: 创建测试文件（内含 3 个 failing cases）**

```javascript
/**
 * dispatcher-circuit-harness-exempt — 熔断器豁免 harness_initiative
 *
 * 验收：
 * - case 1: harness_initiative + 熔断 OPEN → dispatched（不被拦截）
 * - case 2: dev task + 熔断 OPEN → circuit_breaker_open
 * - case 3: harness_initiative + 熔断 CLOSED → dispatched（正常路径不受影响）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) }
}));

vi.mock('../quota-cooling.js', () => ({
  isGlobalQuotaCooling: vi.fn(() => false),
  getQuotaCoolingState: vi.fn(() => ({ active: false })),
}));

vi.mock('../drain.js', () => ({
  isDraining: vi.fn(() => false),
  getDrainStartedAt: vi.fn(() => null),
}));

const mockTriggerCeceliaRun = vi.fn().mockResolvedValue({ success: true, pid: 12345 });
vi.mock('../executor.js', () => ({
  triggerCeceliaRun: (...args) => mockTriggerCeceliaRun(...args),
  checkCeceliaRunAvailable: vi.fn().mockResolvedValue({ available: true }),
  killProcessTwoStage: vi.fn(),
  getBillingPause: vi.fn(() => ({ active: false })),
  getActiveProcessCount: vi.fn(() => 0),
  MAX_SEATS: 12,
  INTERACTIVE_RESERVE: 2,
}));

vi.mock('../slot-allocator.js', () => ({
  calculateSlotBudget: vi.fn().mockResolvedValue({
    dispatchAllowed: true,
    taskPool: { budget: 5, available: 3 },
    user: { mode: 'absent', used: 0 },
    codex: { available: true, running: 0, max: 5 },
  })
}));

vi.mock('../token-budget-planner.js', () => ({ shouldDowngrade: vi.fn(() => false) }));
vi.mock('../event-bus.js', () => ({ emit: vi.fn().mockResolvedValue(undefined) }));

const mockIsAllowed = vi.fn(() => true);
vi.mock('../circuit-breaker.js', () => ({
  isAllowed: (...args) => mockIsAllowed(...args),
  recordFailure: vi.fn(),
  recordSuccess: vi.fn(),
  getAllStates: vi.fn(() => ({})),
}));

vi.mock('../events/taskEvents.js', () => ({
  publishTaskStarted: vi.fn(),
  publishExecutorStatus: vi.fn(),
}));
vi.mock('../dispatch-stats.js', () => ({
  recordDispatchResult: vi.fn().mockResolvedValue(undefined),
  getDispatchStats: vi.fn().mockResolvedValue({}),
}));
vi.mock('../account-usage.js', () => ({
  proactiveTokenCheck: vi.fn().mockResolvedValue({ ok: true })
}));
vi.mock('../quota-guard.js', () => ({
  checkQuotaGuard: vi.fn().mockResolvedValue({ allowed: true })
}));
vi.mock('../actions.js', () => ({
  updateTask: vi.fn().mockResolvedValue({ success: true }),
  createTask: vi.fn(),
}));

const mockSelectNextDispatchableTask = vi.fn();
vi.mock('../dispatch-helpers.js', () => ({
  selectNextDispatchableTask: (...args) => mockSelectNextDispatchableTask(...args),
  processCortexTask: vi.fn(),
}));

vi.mock('../pre-flight-check.js', () => ({
  preFlightCheck: vi.fn().mockResolvedValue({ passed: true, issues: [], suggestions: [] }),
  getPreFlightStats: vi.fn().mockResolvedValue({}),
  alertOnPreFlightFail: vi.fn().mockResolvedValue(undefined),
}));

describe('dispatcher circuit-breaker — harness_initiative 豁免', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    mockIsAllowed.mockReturnValue(true);
    mockTriggerCeceliaRun.mockResolvedValue({ success: true, pid: 12345 });
  });

  it('case 1: harness_initiative + 熔断 OPEN → dispatched（不被拦截）', async () => {
    mockIsAllowed.mockReturnValue(false); // 熔断 OPEN

    mockSelectNextDispatchableTask.mockResolvedValue({
      id: 'task-harness-1',
      task_type: 'harness_initiative',
      project_id: 'proj-1',
      title: 'harness sprint',
    });

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(result.reason).not.toBe('circuit_breaker_open');
    expect(result.dispatched).toBe(true);
  });

  it('case 2: dev task + 熔断 OPEN → circuit_breaker_open', async () => {
    mockIsAllowed.mockReturnValue(false); // 熔断 OPEN

    mockSelectNextDispatchableTask.mockResolvedValue({
      id: 'task-dev-1',
      task_type: 'dev',
      project_id: 'proj-1',
      title: 'dev task',
    });

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('circuit_breaker_open');
  });

  it('case 3: harness_initiative + 熔断 CLOSED → dispatched（正常流程不受影响）', async () => {
    mockIsAllowed.mockReturnValue(true); // 熔断 CLOSED

    mockSelectNextDispatchableTask.mockResolvedValue({
      id: 'task-harness-2',
      task_type: 'harness_initiative',
      project_id: 'proj-2',
      title: 'harness sprint 2',
    });

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(result.dispatched).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试，确认 3 个 case 全部 FAIL（尤其 case 1 和 3）**

```bash
cd /Users/administrator/worktrees/cecelia/dispatcher-circuit-harness-exempt
npx vitest run packages/brain/src/__tests__/dispatcher-circuit-harness-exempt.test.js 2>&1 | tail -30
```

期望：`3 failed`（case 1 失败因为目前熔断 OPEN 时 harness 也被拦截）

- [ ] **Step 3: commit failing tests（commit-1）**

```bash
cd /Users/administrator/worktrees/cecelia/dispatcher-circuit-harness-exempt
git add packages/brain/src/__tests__/dispatcher-circuit-harness-exempt.test.js \
        docs/superpowers/specs/2026-06-08-dispatcher-circuit-harness-exempt-design.md \
        docs/superpowers/plans/2026-06-08-dispatcher-circuit-harness-exempt.md \
        sprints/06080021-dispatcher-circuit-harness-exempt/prep-prd.md
git commit -m "test(dispatcher): add failing regression tests — circuit breaker must exempt harness_initiative"
```

---

### Task 2: 修复 dispatcher.js

**Files:**
- Modify: `packages/brain/src/dispatcher.js`（line 296-300 删除，line 536 后插入）

- [ ] **Step 4: 删除 line 296-300 的全局熔断检查**

在 `packages/brain/src/dispatcher.js` 中找到并删除这段代码：

```javascript
  // 2. Circuit breaker check
  if (!isAllowed('cecelia-run')) {
    await recordDispatchResult(pool, false, 'circuit_breaker_open');
    return { dispatched: false, reason: 'circuit_breaker_open', actions };
  }
```

- [ ] **Step 5: 在 line 536（needsBridgeCheck 行之后）插入条件熔断检查**

找到：
```javascript
  const needsBridgeCheck = nextTask.task_type !== 'harness_initiative';
  const ceceliaAvailable = needsBridgeCheck
    ? await checkCeceliaRunAvailable()
    : { available: true };
```

替换为：
```javascript
  const needsBridgeCheck = nextTask.task_type !== 'harness_initiative';

  // Circuit breaker — 只对依赖 cecelia-bridge 的任务生效（harness_initiative 豁免）
  if (needsBridgeCheck && !isAllowed('cecelia-run')) {
    await updateTask({ task_id: nextTask.id, status: 'queued' });
    await pool.query('UPDATE tasks SET claimed_by = NULL, claimed_at = NULL WHERE id = $1', [nextTask.id]);
    await recordDispatchResult(pool, false, 'circuit_breaker_open');
    return { dispatched: false, reason: 'circuit_breaker_open', actions };
  }

  const ceceliaAvailable = needsBridgeCheck
    ? await checkCeceliaRunAvailable()
    : { available: true };
```

- [ ] **Step 6: 运行测试，确认 3 个 case 全部 PASS**

```bash
cd /Users/administrator/worktrees/cecelia/dispatcher-circuit-harness-exempt
npx vitest run packages/brain/src/__tests__/dispatcher-circuit-harness-exempt.test.js 2>&1 | tail -20
```

期望：`3 passed`

- [ ] **Step 7: 运行相关测试集确认无 regression**

```bash
cd /Users/administrator/worktrees/cecelia/dispatcher-circuit-harness-exempt
npx vitest run packages/brain/src/__tests__/dispatcher-initiative-lock.test.js \
              packages/brain/src/__tests__/dispatcher-circuit-harness-exempt.test.js 2>&1 | tail -20
```

期望：全部 PASS

- [ ] **Step 8: commit 修复代码（commit-2）**

```bash
cd /Users/administrator/worktrees/cecelia/dispatcher-circuit-harness-exempt
git add packages/brain/src/dispatcher.js
git commit -m "fix(dispatcher): exempt harness_initiative from circuit-breaker open check

harness_initiative 走 Docker spawn 路径，不依赖 cecelia-bridge。
全局熔断检查（line 297）在任务选择前拦截所有任务，导致熔断 OPEN 时
harness pipeline 完全卡住。

将熔断判断移至 needsBridgeCheck 旁边（line 536），复用相同豁免条件，
仅拦截真正依赖 cecelia-bridge 的任务类型。"
```
