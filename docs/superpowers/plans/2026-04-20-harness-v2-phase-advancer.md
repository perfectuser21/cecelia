# Harness v2 Phase Advancer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Brain tick 主循环里加 `advanceHarnessInitiatives()`，把 `initiative_runs.phase` 从 A_contract→B_task_loop→C_final_e2e 的晋级逻辑补齐。

**Architecture:** 新增 `harness-phase-advancer.js` 封装推进逻辑；tick.js 的 `executeTick()` 里 dynamic import 调它。依赖 `harness-dag.js` 的 `nextRunnableTask` 和 `harness-initiative-runner.js` 的 `checkAllTasksCompleted` / `runPhaseCIfReady`（都已存在）。

**Tech Stack:** Node.js ESM + vitest + pg Pool/Client

---

## File Structure

**Create:**
- `packages/brain/src/harness-phase-advancer.js` — `advanceHarnessInitiatives(pool, deps?)`
- `packages/brain/src/__tests__/harness-phase-advancer.test.js`

**Modify:**
- `packages/brain/src/tick.js` — `executeTick()` 里在 dispatchNextTask 循环前 dynamic import 并调用 advancer（≤10 行）

---

### Task 1: harness-phase-advancer.js

**Files:**
- Create: `packages/brain/src/harness-phase-advancer.js`
- Test: `packages/brain/src/__tests__/harness-phase-advancer.test.js`

- [ ] **Step 1: Write the failing test**

```js
// packages/brain/src/__tests__/harness-phase-advancer.test.js
import { describe, it, expect, vi } from 'vitest';

function makeMockClient(queryHandler) {
  return {
    query: vi.fn(queryHandler),
    release: vi.fn(),
  };
}

function makeMockPool(client) {
  return {
    connect: vi.fn(async () => client),
  };
}

describe('advanceHarnessInitiatives', () => {
  it('A_contract + contract approved → UPDATE phase=B_task_loop', async () => {
    const updates = [];
    const queryHandler = async (sql, params) => {
      if (sql.includes('FROM initiative_runs')) {
        return { rows: [{ id: 'run-1', initiative_id: 'init-1', phase: 'A_contract', current_task_id: null, contract_id: 'c-1' }] };
      }
      if (sql.includes('FROM initiative_contracts')) {
        return { rows: [{ status: 'approved' }] };
      }
      if (sql.includes('UPDATE initiative_runs')) {
        updates.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    };
    const pool = makeMockPool(makeMockClient(queryHandler));
    const { advanceHarnessInitiatives } = await import('../harness-phase-advancer.js');
    const res = await advanceHarnessInitiatives(pool, {
      nextRunnableTask: vi.fn(),
      checkAllTasksCompleted: vi.fn(),
      runPhaseCIfReady: vi.fn(),
    });
    expect(res.advanced).toBe(1);
    expect(updates.some(u => u.sql.includes("phase='B_task_loop'"))).toBe(true);
  });

  it('A_contract + contract draft → no update', async () => {
    const queryHandler = async (sql) => {
      if (sql.includes('FROM initiative_runs')) {
        return { rows: [{ id: 'run-1', initiative_id: 'init-1', phase: 'A_contract', current_task_id: null, contract_id: 'c-1' }] };
      }
      if (sql.includes('FROM initiative_contracts')) return { rows: [{ status: 'draft' }] };
      if (sql.includes('UPDATE initiative_runs')) throw new Error('should not update');
      return { rows: [] };
    };
    const pool = makeMockPool(makeMockClient(queryHandler));
    const { advanceHarnessInitiatives } = await import('../harness-phase-advancer.js');
    const res = await advanceHarnessInitiatives(pool, {
      nextRunnableTask: vi.fn(),
      checkAllTasksCompleted: vi.fn(),
      runPhaseCIfReady: vi.fn(),
    });
    expect(res.errors).toEqual([]);
    expect(res.advanced).toBe(0);
  });

  it('B_task_loop + current_task completed → update current_task_id to next runnable', async () => {
    const updates = [];
    const queryHandler = async (sql) => {
      if (sql.includes('FROM initiative_runs')) {
        return { rows: [{ id: 'run-1', initiative_id: 'init-1', phase: 'B_task_loop', current_task_id: 't-prev', contract_id: 'c-1' }] };
      }
      if (sql.includes('FROM tasks WHERE id')) return { rows: [{ status: 'completed' }] };
      if (sql.includes('UPDATE initiative_runs') || sql.includes('UPDATE tasks')) {
        updates.push(sql);
        return { rows: [] };
      }
      return { rows: [] };
    };
    const pool = makeMockPool(makeMockClient(queryHandler));
    const { advanceHarnessInitiatives } = await import('../harness-phase-advancer.js');
    const res = await advanceHarnessInitiatives(pool, {
      nextRunnableTask: vi.fn(async () => ({ id: 't-next' })),
      checkAllTasksCompleted: vi.fn(),
      runPhaseCIfReady: vi.fn(),
    });
    expect(res.advanced).toBe(1);
    expect(updates.some(s => s.includes('current_task_id'))).toBe(true);
    expect(updates.some(s => s.includes('UPDATE tasks'))).toBe(true);
  });

  it('B_task_loop + current_task still running → skip', async () => {
    const queryHandler = async (sql) => {
      if (sql.includes('FROM initiative_runs')) {
        return { rows: [{ id: 'run-1', initiative_id: 'init-1', phase: 'B_task_loop', current_task_id: 't-now', contract_id: 'c-1' }] };
      }
      if (sql.includes('FROM tasks WHERE id')) return { rows: [{ status: 'running' }] };
      return { rows: [] };
    };
    const pool = makeMockPool(makeMockClient(queryHandler));
    const nextFn = vi.fn();
    const { advanceHarnessInitiatives } = await import('../harness-phase-advancer.js');
    await advanceHarnessInitiatives(pool, { nextRunnableTask: nextFn, checkAllTasksCompleted: vi.fn(), runPhaseCIfReady: vi.fn() });
    expect(nextFn).not.toHaveBeenCalled();
  });

  it('B_task_loop + no next + all tasks completed → call runPhaseCIfReady', async () => {
    const queryHandler = async (sql) => {
      if (sql.includes('FROM initiative_runs')) {
        return { rows: [{ id: 'run-1', initiative_id: 'init-1', phase: 'B_task_loop', current_task_id: null, contract_id: 'c-1' }] };
      }
      return { rows: [] };
    };
    const pool = makeMockPool(makeMockClient(queryHandler));
    const runC = vi.fn(async () => ({ status: 'e2e_pass' }));
    const { advanceHarnessInitiatives } = await import('../harness-phase-advancer.js');
    await advanceHarnessInitiatives(pool, {
      nextRunnableTask: vi.fn(async () => null),
      checkAllTasksCompleted: vi.fn(async () => ({ all: true, total: 3, completed: 3, remaining: 0 })),
      runPhaseCIfReady: runC,
    });
    expect(runC).toHaveBeenCalledWith('init-1', expect.any(Object));
  });

  it('B_task_loop + no next + not all completed → no action', async () => {
    const queryHandler = async (sql) => {
      if (sql.includes('FROM initiative_runs')) {
        return { rows: [{ id: 'run-1', initiative_id: 'init-1', phase: 'B_task_loop', current_task_id: null, contract_id: 'c-1' }] };
      }
      return { rows: [] };
    };
    const pool = makeMockPool(makeMockClient(queryHandler));
    const runC = vi.fn();
    const { advanceHarnessInitiatives } = await import('../harness-phase-advancer.js');
    await advanceHarnessInitiatives(pool, {
      nextRunnableTask: vi.fn(async () => null),
      checkAllTasksCompleted: vi.fn(async () => ({ all: false, total: 3, completed: 1, remaining: 2 })),
      runPhaseCIfReady: runC,
    });
    expect(runC).not.toHaveBeenCalled();
  });

  it('isolates per-run errors - one run throws, others still advance', async () => {
    let callSeq = 0;
    const updates = [];
    const queryHandler = async (sql) => {
      if (sql.includes('FROM initiative_runs') && !sql.includes('UPDATE')) {
        return {
          rows: [
            { id: 'run-bad', initiative_id: 'init-bad', phase: 'A_contract', current_task_id: null, contract_id: 'c-bad' },
            { id: 'run-good', initiative_id: 'init-good', phase: 'A_contract', current_task_id: null, contract_id: 'c-good' },
          ],
        };
      }
      if (sql.includes('FROM initiative_contracts')) {
        callSeq++;
        if (callSeq === 1) throw new Error('contract lookup failed');
        return { rows: [{ status: 'approved' }] };
      }
      if (sql.includes('UPDATE initiative_runs')) {
        updates.push(sql);
        return { rows: [] };
      }
      return { rows: [] };
    };
    const pool = makeMockPool(makeMockClient(queryHandler));
    const { advanceHarnessInitiatives } = await import('../harness-phase-advancer.js');
    const res = await advanceHarnessInitiatives(pool, {
      nextRunnableTask: vi.fn(),
      checkAllTasksCompleted: vi.fn(),
      runPhaseCIfReady: vi.fn(),
    });
    expect(res.errors.length).toBe(1);
    expect(res.advanced).toBe(1);
    expect(updates.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-phase-advancer.test.js`
Expected: FAIL — "Cannot find module '../harness-phase-advancer.js'"

- [ ] **Step 3: Write minimal implementation**

```js
// packages/brain/src/harness-phase-advancer.js
import { nextRunnableTask as defaultNextRunnableTask } from './harness-dag.js';
import {
  checkAllTasksCompleted as defaultCheckAllTasksCompleted,
  runPhaseCIfReady as defaultRunPhaseCIfReady,
} from './harness-initiative-runner.js';

const ACTIVE_PHASES = ['A_contract', 'B_task_loop', 'C_final_e2e'];
const MAX_RUNS_PER_TICK = 50;
const RUNNING_STATUSES = new Set(['queued', 'running', 'in_progress']);

/**
 * Brain tick 内钩子：扫描活跃 initiative_runs 并晋级 phase。
 *
 * @param {object} pool                pg Pool
 * @param {object} [deps]              测试注入
 * @param {Function} [deps.nextRunnableTask]
 * @param {Function} [deps.checkAllTasksCompleted]
 * @param {Function} [deps.runPhaseCIfReady]
 * @returns {Promise<{advanced:number, errors:Array<{runId,error}>}>}
 */
export async function advanceHarnessInitiatives(pool, deps = {}) {
  const nextRunnableTask = deps.nextRunnableTask || defaultNextRunnableTask;
  const checkAllTasksCompleted = deps.checkAllTasksCompleted || defaultCheckAllTasksCompleted;
  const runPhaseCIfReady = deps.runPhaseCIfReady || defaultRunPhaseCIfReady;

  const client = await pool.connect();
  let advanced = 0;
  const errors = [];

  try {
    const { rows: runs } = await client.query(
      `SELECT id, initiative_id, phase, current_task_id, contract_id
       FROM initiative_runs
       WHERE phase = ANY ($1::text[])
         AND (updated_at IS NULL OR updated_at < NOW() - INTERVAL '5 seconds')
       ORDER BY updated_at NULLS FIRST
       LIMIT $2`,
      [ACTIVE_PHASES, MAX_RUNS_PER_TICK]
    );

    for (const run of runs) {
      try {
        const changed = await advanceSingleRun(run, client, {
          nextRunnableTask, checkAllTasksCompleted, runPhaseCIfReady, pool,
        });
        if (changed) advanced += 1;
      } catch (err) {
        console.error(`[harness-advance] run=${run.id} error: ${err.message}`);
        errors.push({ runId: run.id, error: err.message });
      }
    }
  } finally {
    client.release();
  }

  return { advanced, errors };
}

async function advanceSingleRun(run, client, deps) {
  if (run.phase === 'A_contract') {
    const { rows } = await client.query(
      `SELECT status FROM initiative_contracts WHERE id = $1::uuid`,
      [run.contract_id]
    );
    if (rows[0]?.status === 'approved') {
      await client.query(
        `UPDATE initiative_runs SET phase='B_task_loop', updated_at=NOW() WHERE id=$1::uuid`,
        [run.id]
      );
      return true;
    }
    return false;
  }

  if (run.phase === 'B_task_loop') {
    if (run.current_task_id) {
      const { rows } = await client.query(
        `SELECT status FROM tasks WHERE id = $1::uuid`,
        [run.current_task_id]
      );
      if (rows[0] && RUNNING_STATUSES.has(rows[0].status)) return false;
    }

    const next = await deps.nextRunnableTask(run.initiative_id, { client });
    if (next) {
      await client.query(
        `UPDATE initiative_runs SET current_task_id=$1::uuid, updated_at=NOW() WHERE id=$2::uuid`,
        [next.id, run.id]
      );
      await client.query(
        `UPDATE tasks SET status='queued', updated_at=NOW()
         WHERE id=$1::uuid AND status <> 'queued'`,
        [next.id]
      );
      return true;
    }

    const stat = await deps.checkAllTasksCompleted(run.initiative_id, client);
    if (stat && stat.all) {
      await deps.runPhaseCIfReady(run.initiative_id, { pool: deps.pool });
      return true;
    }
    return false;
  }

  // C_final_e2e: runPhaseCIfReady 内部自管，这里不动
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-phase-advancer.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/harness-v2-phase-advancer
git add packages/brain/src/harness-phase-advancer.js packages/brain/src/__tests__/harness-phase-advancer.test.js
git commit -m "feat(harness-v2): add advanceHarnessInitiatives phase advancer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: tick.js — 在 executeTick 里调 advanceHarnessInitiatives

**Files:**
- Modify: `packages/brain/src/tick.js` — `executeTick()` 里 `dispatchNextTask` 循环之前插入调用

- [ ] **Step 1: Locate insertion point**

Run: `grep -n "dispatchNextTask" packages/brain/src/tick.js | head -5`
找到 `dispatchNextTask` 第一次在 executeTick 内被调用的位置（按 research 报告应该在 ~line 2854 附近的 for loop），在该循环的 `for (` 那行之前插入 advancer 调用。

- [ ] **Step 2: Edit tick.js**

在找到的插入点前加：

```js
// Harness v2 phase 推进器（PR-3）：A→B→C 晋级
try {
  const { advanceHarnessInitiatives } = await import('./harness-phase-advancer.js');
  await advanceHarnessInitiatives(pool);
} catch (err) {
  console.error('[harness-advance] tick error:', err.message);
}
```

`pool` 变量在 tick.js 顶部已 import（from `./db.js`）。若当前作用域用的是不同名字（比如 `dbPool`），按实际替换。

- [ ] **Step 3: Verify no regression**

Run: 
```
cd packages/brain && npx vitest run src/__tests__/harness-phase-advancer.test.js src/__tests__/harness-initiative-runner-phase-c.test.js src/__tests__/harness-task-dispatch.test.js 2>&1 | tail -10
```
Expected: 7 + 17 + 7 = 31 PASS

- [ ] **Step 4: Verify insertion by grep**

Run: `grep -n "advanceHarnessInitiatives" packages/brain/src/tick.js`
Expected: 看到 import + await 两行。

- [ ] **Step 5: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/harness-v2-phase-advancer
git add packages/brain/src/tick.js
git commit -m "feat(harness-v2): wire advanceHarnessInitiatives into tick loop

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Learning + DoD 勾选

**Files:**
- Create: `docs/learnings/cp-0420181142-harness-v2-phase-advancer.md`
- Modify: `docs/superpowers/specs/2026-04-20-harness-v2-phase-advancer-design.md`（5 条 DoD 全部 `[x]`）

- [ ] **Step 1: Write learning**

```markdown
# Harness v2 Phase Advancer

### 根本原因

Harness v2 `initiative_runs.phase` 字段定义了 A_contract/B_task_loop/C_final_e2e 状态，但没有任何代码推进——合同 approved 后不会进 B、所有子 Task completed 后也不会调 runPhaseCIfReady。结果 Planner 跑完 Initiative 就卡在 A_contract，E2E 永远出不了头。

### 下次预防

- [ ] 设计状态机必须同时设计"推进器"（谁在什么时机转移状态），不只定义状态
- [ ] 任何后台 tick 钩子都要跑"异常隔离"（单 run 抛错不能污染其他 run）+"tick 重叠防御"（updated_at 窗口过滤）
- [ ] 推进器必须全部 DI 可测（nextRunnableTask / checkAllTasksCompleted / runPhaseCIfReady 都暴露依赖注入）
- [ ] 新增 tick hook 一律 dynamic import + try/catch 包裹，避免启动时依赖加载失败 kill tick
```

- [ ] **Step 2: Tick DoD checkboxes**

Edit `docs/superpowers/specs/2026-04-20-harness-v2-phase-advancer-design.md`：把 `## 成功标准` 5 条的 `- [ ]` 全改 `- [x]`。

- [ ] **Step 3: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/harness-v2-phase-advancer
git add docs/learnings/cp-0420181142-harness-v2-phase-advancer.md docs/superpowers/specs/2026-04-20-harness-v2-phase-advancer-design.md
git commit -m "docs(harness-v2): learning + DoD [x] for PR-3

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

1. **Spec coverage**：
   - `advanceHarnessInitiatives` → Task 1
   - tick.js hook → Task 2
   - A→B, B 推进, B→C, 异常隔离 → Task 1 test cases
   - DoD 5 条 → Task 3
2. **Placeholder scan**：无 TBD/TODO，代码完整。
3. **Type consistency**：`nextRunnableTask(id, {client})` / `checkAllTasksCompleted(id, client)` / `runPhaseCIfReady(id, {pool})` 签名从 research 取、Task 1/2 一致。

---

## Execution Handoff

Plan 完成。/dev 自主规则 Subagent-Driven。
