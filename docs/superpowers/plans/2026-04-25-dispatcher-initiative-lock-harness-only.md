# Dispatcher Initiative Lock 收紧到 harness 类型 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dispatcher.js 的 initiative-level lock 改为 task_type 白名单，dev/talk/audit 不再被锁。

**Architecture:** 在 dispatcher.js 顶部加 `INITIATIVE_LOCK_TASK_TYPES` 常量，修改 `dispatchNextTask` 内 lockCheck SQL 加 `task_type IN (...)` 过滤。新增 vitest 单元测试覆盖三个核心 case。

**Tech Stack:** Node.js, vitest, PostgreSQL（pg）

---

## File Structure

- Modify: `packages/brain/src/dispatcher.js`（加常量 + 改 lockCheck SQL）
- Create: `packages/brain/src/__tests__/dispatcher-initiative-lock.test.js`（新单测）
- Modify: `.dod.cp-0425185113-dispatcher-initiative-lock-harness-only.md`（DoD 文件由 engine 自动生成，需补 BEHAVIOR/ARTIFACT 条目）
- Create: `docs/learnings/cp-0425185113-dispatcher-initiative-lock-harness-only.md`（首次 push 前必须）

---

### Task 1: 写失败测试（TDD Red）

**Files:**
- Create: `packages/brain/src/__tests__/dispatcher-initiative-lock.test.js`

- [ ] **Step 1: 写测试文件**

```javascript
/**
 * dispatcher-initiative-lock — initiative lock 收紧到 harness 类型
 *
 * 验收：
 * - case 1: 同 project_id 有 harness_task in_progress → 同 project_id 的 harness_task 被锁
 * - case 2: 同 project_id 有 harness_task in_progress → 同 project_id 的 dev task 不被锁可派
 * - case 3: 同 project_id 有 dev task in_progress → 同 project_id 的 harness_task 不被锁可派
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

vi.mock('../executor.js', () => ({
  triggerCeceliaRun: vi.fn().mockResolvedValue({ success: true, pid: 12345 }),
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
vi.mock('../circuit-breaker.js', () => ({
  isAllowed: vi.fn(() => true), recordFailure: vi.fn(), recordSuccess: vi.fn(),
  getAllStates: vi.fn(() => ({})),
}));
vi.mock('../events/taskEvents.js', () => ({
  publishTaskStarted: vi.fn(), publishExecutorStatus: vi.fn(),
}));
vi.mock('../dispatch-stats.js', () => ({
  recordDispatchResult: vi.fn().mockResolvedValue(undefined),
  getDispatchStats: vi.fn().mockResolvedValue({}),
}));
vi.mock('../account-usage.js', () => ({ proactiveTokenCheck: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('../quota-guard.js', () => ({ checkQuotaGuard: vi.fn().mockResolvedValue({ allowed: true }) }));
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

describe('dispatcher initiative-lock — task_type 白名单', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
  });

  it('case 1: harness_task vs harness_task same project → initiative_locked', async () => {
    mockSelectNextDispatchableTask.mockResolvedValue({
      id: 'task-A', task_type: 'harness_task', project_id: 'proj-1', title: 'A',
    });
    // lockCheck SQL：返回另一个 harness_task in_progress 作为 blocker
    mockQuery.mockImplementation((sql, params) => {
      if (/SELECT id, title FROM tasks/.test(sql) && /task_type/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 'task-B', title: 'blocker harness' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('initiative_locked');
    expect(result.blocking_task_id).toBe('task-B');
  });

  it('case 2: dev task vs harness blocker same project → 不查 lock，不 initiative_locked', async () => {
    mockSelectNextDispatchableTask.mockResolvedValue({
      id: 'task-dev', task_type: 'dev', project_id: 'proj-1', title: 'dev',
    });
    // 任何 SELECT 返回空（lock check 不应被调用，但保险起见）
    mockQuery.mockResolvedValue({ rows: [] });

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(result.reason).not.toBe('initiative_locked');

    // 关键断言：lock check SQL（含 task_type 白名单 + project_id）不应被调用
    const lockCheckCalls = mockQuery.mock.calls.filter(([sql]) =>
      /SELECT id, title FROM tasks/.test(sql) && /task_type/.test(sql)
    );
    expect(lockCheckCalls).toHaveLength(0);
  });

  it('case 3: harness_task vs dev blocker same project → SQL 过滤掉 dev blocker，可派', async () => {
    mockSelectNextDispatchableTask.mockResolvedValue({
      id: 'task-H', task_type: 'harness_task', project_id: 'proj-1', title: 'harness',
    });
    // lockCheck SQL：因 task_type 过滤，无 harness blocker 命中 → 返回空
    mockQuery.mockImplementation((sql, params) => {
      if (/SELECT id, title FROM tasks/.test(sql) && /task_type/.test(sql)) {
        // 验证 SQL 含 task_type = ANY 过滤条件
        expect(sql).toMatch(/task_type\s*=\s*ANY/i);
        // 验证白名单含 6 项
        const whitelist = params[2];
        expect(whitelist).toEqual(expect.arrayContaining([
          'harness_task', 'harness_planner', 'harness_contract_propose',
          'harness_contract_review', 'harness_fix', 'harness_initiative',
        ]));
        return Promise.resolve({ rows: [] }); // 模拟 dev blocker 被过滤掉
      }
      return Promise.resolve({ rows: [] });
    });

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(result.reason).not.toBe('initiative_locked');
  });
});
```

- [ ] **Step 2: 跑测试确认失败（Red）**

Run: `cd packages/brain && npx vitest run src/__tests__/dispatcher-initiative-lock.test.js`
Expected: 3 个 case 失败 — case 1 reason 不是 initiative_locked / case 2-3 SQL 不含 task_type ANY

---

### Task 2: 实现（TDD Green）

**Files:**
- Modify: `packages/brain/src/dispatcher.js`

- [ ] **Step 3: 在文件顶部加常量**

在 `packages/brain/src/dispatcher.js` 第 36 行 `const MINIMAL_MODE = ...` 之前插入：

```javascript
// Initiative-level lock 仅对 harness pipeline 类型生效。
// dev / talk / audit / qa 等通用任务不持有 initiative lock，避免单 project 内死锁。
const INITIATIVE_LOCK_TASK_TYPES = [
  'harness_task',
  'harness_planner',
  'harness_contract_propose',
  'harness_contract_review',
  'harness_fix',
  'harness_initiative',
];
```

- [ ] **Step 4: 改 lockCheck SQL（L277-L289）**

把：

```javascript
  // 3c. Initiative-level lock: double-check before marking in_progress (guard against race)
  if (nextTask.project_id) {
    const lockCheck = await pool.query(
      "SELECT id, title FROM tasks WHERE project_id = $1 AND status = 'in_progress' AND id != $2 LIMIT 1",
      [nextTask.project_id, nextTask.id]
    );
    if (lockCheck.rows.length > 0) {
      const blocker = lockCheck.rows[0];
      tickLog(`[dispatch] Initiative 已有进行中任务 (task_id: ${blocker.id})，跳过派发: ${nextTask.title}`);
      await recordDispatchResult(pool, false, 'initiative_locked');
      return { dispatched: false, reason: 'initiative_locked', blocking_task_id: blocker.id, task_id: nextTask.id, actions };
    }
  }
```

改成：

```javascript
  // 3c. Initiative-level lock: 仅对 harness pipeline 类型生效，且只查同 project 的 harness blocker。
  //     dev / talk / audit 等通用任务不进入这条分支，避免单 project 死锁（bb245cb4 教训）。
  if (nextTask.project_id && INITIATIVE_LOCK_TASK_TYPES.includes(nextTask.task_type)) {
    const lockCheck = await pool.query(
      `SELECT id, title FROM tasks
       WHERE project_id = $1
         AND status = 'in_progress'
         AND task_type = ANY($3::text[])
         AND id != $2
       LIMIT 1`,
      [nextTask.project_id, nextTask.id, INITIATIVE_LOCK_TASK_TYPES]
    );
    if (lockCheck.rows.length > 0) {
      const blocker = lockCheck.rows[0];
      tickLog(`[dispatch] Initiative 已有进行中 harness 任务 (task_id: ${blocker.id})，跳过派发: ${nextTask.title}`);
      await recordDispatchResult(pool, false, 'initiative_locked');
      return { dispatched: false, reason: 'initiative_locked', blocking_task_id: blocker.id, task_id: nextTask.id, actions };
    }
  }
```

- [ ] **Step 5: 跑测试确认通过（Green）**

Run: `cd packages/brain && npx vitest run src/__tests__/dispatcher-initiative-lock.test.js`
Expected: 3 个 case 全部 PASS

- [ ] **Step 6: 跑相关回归测试**

Run: `cd packages/brain && npx vitest run src/__tests__/dispatcher-quota-cooling.test.js src/__tests__/dispatch-preflight-skip.test.js src/__tests__/harness-task-dispatch.test.js`
Expected: 全部 PASS（现有 dispatcher 测试不应被破坏）

- [ ] **Step 7: 跑 facts-check + version-sync（Brain 改动 DevGate）**

Run: `node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/engine/scripts/devgate/check-dod-mapping.cjs`
Expected: 全部 PASS

---

### Task 3: 补 DoD + Learning，commit + push

**Files:**
- Modify: `.dod.cp-0425185113-dispatcher-initiative-lock-harness-only.md`
- Create: `docs/learnings/cp-0425185113-dispatcher-initiative-lock-harness-only.md`

- [ ] **Step 8: 编辑 DoD 文件**

确保至少一个 `[BEHAVIOR]` 条目，所有勾选 `[x]`：

```markdown
## DoD

- [x] [ARTIFACT] dispatcher.js 含 INITIATIVE_LOCK_TASK_TYPES 常量
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/dispatcher.js','utf8');if(!/INITIATIVE_LOCK_TASK_TYPES/.test(c))process.exit(1)"

- [x] [ARTIFACT] lockCheck SQL 含 task_type = ANY 过滤
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/dispatcher.js','utf8');if(!/task_type\s*=\s*ANY/.test(c))process.exit(1)"

- [x] [BEHAVIOR] 单元测试 dispatcher-initiative-lock 三 case 全 pass
  Test: tests/dispatcher-initiative-lock.test.js
```

- [ ] **Step 9: 写 Learning**

```markdown
# Learning: dispatcher initiative-lock 收紧到 harness 类型

### 根本原因
dispatcher.js initiative-level lock 用 project_id 一刀切，bb245cb4 Initiative 跑 Phase A 时
其他 dev/talk/audit 任务全被拒派 = 整个 project 死锁。lock 设计初衷是防止 harness pipeline
内部互相抢资源，不该牵连通用任务。

### 下次预防
- [ ] 任何"按 project_id 一刀切"的 lock/限流前先确认 task_type 维度
- [ ] 引入新 lock 时显式声明白名单 / 黑名单常量，禁止隐式
- [ ] dispatcher.js lock SQL 改动必须配 unit test 覆盖至少 3 case（同类锁、跨类放、反向放）
```

- [ ] **Step 10: commit**

```bash
git add packages/brain/src/dispatcher.js \
        packages/brain/src/__tests__/dispatcher-initiative-lock.test.js \
        .dod.cp-0425185113-dispatcher-initiative-lock-harness-only.md \
        docs/learnings/cp-0425185113-dispatcher-initiative-lock-harness-only.md
git commit -m "fix(brain): initiative-level lock 收紧到 harness 类型，不再卡 dev/talk/audit"
```

- [ ] **Step 11: push + 创建 PR**

由 finishing skill 接管，Option 2（push + PR）。

- [ ] **Step 12: 前台阻塞等 CI**

```bash
until [[ $(gh pr checks <pr-number> 2>/dev/null | grep -cE 'pending|queued') == 0 ]]; do sleep 30; done
```

Expected: 所有 CI 绿。

---

## Self-Review

1. Spec coverage: 三个成功标准均有对应任务（ARTIFACT 由 dispatcher.js 改动覆盖；两个 BEHAVIOR 由 Task 1 单元测试覆盖）。
2. Placeholder scan: 无 TBD/TODO，所有代码都贴了完整内容。
3. Type consistency: `INITIATIVE_LOCK_TASK_TYPES` 在常量和 SQL 参数处保持一致；`task_type` 字段名跟 dispatcher.js 现有用法（L308）一致。
