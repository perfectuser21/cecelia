# Fix Dispatcher Claim Leak (Notion issue fabf6bd6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `harness_initiative` tasks from permanently deadlocking Brain's dispatcher when claim succeeds but the graph never actually starts running.

**Architecture:** Two independent, additive fixes in `packages/brain/src/dispatcher.js` and `packages/brain/src/harness-watchdog.js`. No refactor, no new files besides tests. Root cause (confirmed by code tracing, not guesswork):

1. `dispatchNextTask()` in `dispatcher.js` does an atomic claim (`claimed_by`) + marks the task `in_progress`, then runs ~180 more lines of DB queries / dynamic imports / executor dispatch with **no top-level try/catch**. Any unexpected exception in that span leaves the task claimed + `in_progress` forever, with zero cleanup. The caller (`tick-runner.js:1422`) doesn't catch either.
2. Separately, when `triggerCeceliaRun()` explicitly reports `execResult.success === false`, the code reverts `status` to `queued` but **forgets to clear `claimed_by`/`claimed_at`** — so the atomic claim query (`WHERE claimed_by IS NULL`) can never re-select that task again. Same family of bug, found while reading the code this fix touches.
3. `harness-watchdog.js::resumeStalledHarnessDrivers()` already has a robust heartbeat-based recovery mechanism for stalled harness graphs — but every query in it requires an existing `initiative_runs` row (`JOIN`/`EXISTS`). A task that never even got that far (matches the issue's `initiative_runs=0` symptom exactly) is invisible to it. This plan adds a new branch for that case.

**Excluded (verified NOT root cause):** the issue's "schema drift (`retry_count` column missing)" theory. Verified via `psql \d checkpoints` / `\d initiative_runs` against migrations 244/238 — no code path queries a `retry_count` column on either table. No DB/schema changes in this plan.

**Tech Stack:** Node.js, vitest, pg (mocked in tests), existing Brain dispatcher/watchdog modules.

---

### Task 1: Failing test — dispatcher claim leak on mid-flight exception

**Files:**
- Create: `packages/brain/src/__tests__/dispatcher-claim-leak.test.js`

- [ ] **Step 1: Write the failing test**

Follow the mocking pattern already used in `packages/brain/src/__tests__/dispatcher-harness-concurrency-cap.test.js` (same repo, read it for reference — it mocks every dependency `dispatchNextTask` touches). Write:

```javascript
/**
 * dispatcher-claim-leak.test.js
 *
 * Regression test for Notion issue fabf6bd6 — harness dispatcher deadlock.
 *
 * Root cause: dispatchNextTask() claims a task (claimed_by + status=in_progress)
 * then runs ~180 more lines with no top-level try/catch. Any unexpected exception
 * in that span left the task claimed + in_progress forever (no process, no graph,
 * initiative_runs=0 — because the exception fires before the graph even starts).
 *
 * This test forces the "SELECT * FROM tasks WHERE id" query (which runs right after
 * claim, before triggerCeceliaRun) to throw, and asserts the claim is released and
 * the task is marked failed instead of being left dangling.
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
  triggerCeceliaRun: vi.fn().mockResolvedValue({ success: true, pid: 12345, runId: 'run-1' }),
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
    budgetState: { state: 'abundant' },
  })
}));
vi.mock('../token-budget-planner.js', () => ({ shouldDowngrade: vi.fn(() => false) }));
vi.mock('../event-bus.js', () => ({ emit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../circuit-breaker.js', () => ({
  isAllowed: vi.fn(() => true),
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
  checkQuotaGuard: vi.fn().mockResolvedValue({ allow: true })
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

describe('dispatchNextTask — claim leak on mid-flight exception (fabf6bd6)', () => {
  const TASK_ID = 'bd7e251c-0000-0000-0000-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockSelectNextDispatchableTask.mockReset();
    mockSelectNextDispatchableTask.mockResolvedValue({
      id: TASK_ID,
      task_type: 'harness_initiative',
      project_id: null,
      title: 'harness task that will explode',
    });
  });

  it('claim 成功后若后续查询抛异常 → claimed_by 被释放 + status 标 failed，不留在 in_progress', async () => {
    let releasedClaim = false;
    let markedFailed = false;

    mockQuery.mockImplementation((sql, params) => {
      if (/UPDATE tasks SET claimed_by\s*=\s*\$1/.test(sql)) {
        // atomic claim succeeds
        return Promise.resolve({ rows: [{ id: TASK_ID }] });
      }
      if (/SELECT \* FROM tasks WHERE id/.test(sql)) {
        // this is the query dispatchNextTask runs right after claim — force it to blow up
        return Promise.reject(new Error('simulated transient DB error'));
      }
      if (/UPDATE tasks SET claimed_by\s*=\s*NULL/.test(sql)) {
        releasedClaim = true;
        return Promise.resolve({ rows: [] });
      }
      if (/UPDATE tasks SET status\s*=\s*'failed'/.test(sql)) {
        markedFailed = true;
        expect(params.join(' ')).toContain(TASK_ID);
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    // must NOT throw/reject — must return a normal result object
    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('dispatch_exception');
    expect(result.task_id).toBe(TASK_ID);
    expect(releasedClaim).toBe(true);
    expect(markedFailed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/brain && npx vitest run src/__tests__/dispatcher-claim-leak.test.js`
Expected: FAIL — the thrown error from the mocked "SELECT * FROM tasks WHERE id" query propagates out of `dispatchNextTask` as an unhandled rejection (test fails with the raw "simulated transient DB error", not the expected `result.reason === 'dispatch_exception'`).

- [ ] **Step 3: Commit (commit-1, test only)**

```bash
git add packages/brain/src/__tests__/dispatcher-claim-leak.test.js
git commit -m "test: add regression test for dispatcher claim leak (fabf6bd6)"
```

---

### Task 2: Implement dispatcher.js fix

**Files:**
- Modify: `packages/brain/src/dispatcher.js:505-690` (inside `dispatchNextTask`)

- [ ] **Step 1: Wrap the post-claim body in try/catch**

Open `packages/brain/src/dispatcher.js`. Find this line (currently ~line 505):

```javascript
  // 4. Update task status to in_progress
  const updateResult = await updateTask({
```

Change it to:

```javascript
  // 4. Update task status to in_progress
  try {
  const updateResult = await updateTask({
```

(Yes, the indentation of the wrapped body stays as-is — only add the `try {` line before it and the `catch` block after. Don't re-indent 180 lines by hand; a formatter/linter running later is fine, or indent it properly if your editor does it automatically. Correctness matters more than indentation here.)

Then find the very end of the function — the last two lines currently are:

```javascript
  // Record dispatch success to rolling window stats
  await recordDispatchResult(pool, true);

  return { dispatched: true, task_id: nextTask.id, run_id: execResult.runId, actions };
}
```

Change to:

```javascript
  // Record dispatch success to rolling window stats
  await recordDispatchResult(pool, true);

  return { dispatched: true, task_id: nextTask.id, run_id: execResult.runId, actions };
  } catch (err) {
    // C1 fix (fabf6bd6): claim 成功后到这里之间任何未预期异常都会让 task 永久卡在
    // claimed_by 已设 + status=in_progress（graph 从未真正 invoke）。兜底释放 claim + 标 failed，
    // 绝不 rethrow — dispatcher 调用方（tick-runner.js）没有包 try/catch。
    console.error(`[dispatch] unexpected exception after claim, task=${nextTask?.id}: ${err.message}`);
    if (nextTask?.id) {
      try {
        await pool.query(
          `UPDATE tasks SET claimed_by = NULL, claimed_at = NULL WHERE id = $1`,
          [nextTask.id]
        );
        await pool.query(
          `UPDATE tasks SET status = 'failed', error_message = $2 WHERE id = $1`,
          [nextTask.id, String(err.message || 'dispatch_exception').slice(0, 500)]
        );
      } catch (cleanupErr) {
        console.error(`[dispatch] claim-leak cleanup failed (task=${nextTask.id}): ${cleanupErr.message}`);
      }
    }
    await recordDispatchResult(pool, false, 'dispatch_exception');
    return { dispatched: false, reason: 'dispatch_exception', task_id: nextTask?.id, error: err.message, actions };
  }
}
```

Note: `nextTask` is declared with `let nextTask = null;` earlier in the function (around line 332) and assigned at `nextTask = candidate;` right before the loop `break;` — so it's in scope for the catch block since the catch is still inside the same function body.

- [ ] **Step 2: Fix the second, adjacent leak found while reading this code — `execResult.success === false` path doesn't clear claimed_by**

Find (currently ~line 602-606):

```javascript
  if (!execResult.success) {
    console.warn(`[dispatch] triggerCeceliaRun failed for task ${nextTask.id}: ${execResult.error || execResult.reason}`);
    await updateTask({ task_id: nextTask.id, status: 'queued' });
```

Change to:

```javascript
  if (!execResult.success) {
    console.warn(`[dispatch] triggerCeceliaRun failed for task ${nextTask.id}: ${execResult.error || execResult.reason}`);
    await updateTask({ task_id: nextTask.id, status: 'queued' });
    // fabf6bd6: 必须同时释放 claim，否则 status=queued 但 claimed_by 仍设，atomic claim
    // 的 `WHERE claimed_by IS NULL` 永远选不中这个 task，等于换了个状态的同款死锁。
    await pool.query(
      `UPDATE tasks SET claimed_by = NULL, claimed_at = NULL WHERE id = $1`,
      [nextTask.id]
    );
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cd packages/brain && npx vitest run src/__tests__/dispatcher-claim-leak.test.js`
Expected: PASS

- [ ] **Step 4: Run full dispatcher test suite to check for regressions**

Run: `cd packages/brain && npx vitest run src/__tests__/dispatcher.test.js src/__tests__/dispatcher-default-graph.test.js src/__tests__/dispatcher-harness-concurrency-cap.test.js src/__tests__/dispatcher-initiative-lock.test.js src/__tests__/dispatcher-hol.test.js src/__tests__/dispatcher-quota-cooling.test.js src/__tests__/dispatcher-config-error-no-breaker.test.js src/__tests__/dispatcher-resume-cap-exempt.test.js src/__tests__/dispatcher-circuit-harness-exempt.test.js src/__tests__/dispatch-executor-fail.test.js`
Expected: PASS (all). If `dispatch-executor-fail.test.js` fails because it asserts on the exact SQL/params of the `execResult.success===false` path from Step 2, update its assertions to also expect the new `claimed_by = NULL` query — don't weaken the new behavior to make the old test pass.

- [ ] **Step 5: Commit (commit-2, implementation)**

```bash
git add packages/brain/src/dispatcher.js
git commit -m "fix(brain): release claim + mark failed on dispatch exception (fabf6bd6)"
```

---

### Task 3: Failing test — harness-watchdog "never started" recovery

**Files:**
- Create: `packages/brain/src/__tests__/harness-watchdog-never-started.test.js`

- [ ] **Step 1: Write the failing test**

Follow the mocking pattern from `packages/brain/src/__tests__/harness-driver-heartbeat-watchdog.test.js` (read it for reference).

```javascript
/**
 * harness-watchdog-never-started.test.js
 *
 * Regression test for Notion issue fabf6bd6 — harness dispatcher deadlock.
 *
 * Gap: resumeStalledHarnessDrivers() already recovers stalled graphs via heartbeat,
 * but every query requires an existing initiative_runs row (JOIN/EXISTS). A task
 * that never even got that far (claim succeeded, status=in_progress, but the graph
 * never invoked — matches the issue's `initiative_runs=0` symptom) is invisible to
 * both existing sections (A and B). This test covers the new "never started" branch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPoolQuery = vi.hoisted(() => vi.fn());

vi.mock('../db.js', () => ({
  default: { query: mockPoolQuery },
}));

let resumeStalledHarnessDrivers;

beforeEach(async () => {
  vi.resetModules();
  mockPoolQuery.mockReset();
  const mod = await import('../harness-watchdog.js');
  resumeStalledHarnessDrivers = mod.resumeStalledHarnessDrivers;
});

describe('resumeStalledHarnessDrivers — never-started branch (fabf6bd6)', () => {
  it('SELECT 含 NOT EXISTS initiative_runs + claimed_at 陈旧判据', async () => {
    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
    await resumeStalledHarnessDrivers({});
    const allSql = mockPoolQuery.mock.calls.map(c => c[0]).join('\n');
    expect(allSql).toMatch(/NOT\s+EXISTS/i);
    expect(allSql).toMatch(/initiative_runs/);
    expect(allSql).toMatch(/claimed_at/i);
  });

  it('in_progress + 无 initiative_runs 行 + claimed_at 超过阈值(20min) → 标 failed + 释放 claim', async () => {
    const TASK_ID = 'cccc1111-2222-3333-4444-555566667777';
    let updateSql = '';
    let updateParams = [];
    mockPoolQuery.mockImplementation(async (sql, params) => {
      if (/SELECT/i.test(sql) && /NOT\s+EXISTS/i.test(sql) && /initiative_runs/.test(sql)) {
        return { rows: [{ id: TASK_ID }] };
      }
      if (/SELECT/i.test(sql)) return { rows: [] };
      if (/UPDATE\s+tasks/i.test(sql)) {
        updateSql = sql;
        updateParams = params;
        return { rows: [{ id: TASK_ID }] };
      }
      return { rows: [] };
    });

    const r = await resumeStalledHarnessDrivers({});

    expect(updateSql).toMatch(/status\s*=\s*'failed'/i);
    expect(updateSql).toMatch(/claimed_by\s*=\s*NULL/i);
    expect(updateParams.join(' ')).toContain(TASK_ID);
    // must be counted somewhere in the return value (resumed or a dedicated field)
    expect(JSON.stringify(r)).toContain(TASK_ID);
  });

  it('刚 claim 不久（claimed_at 1 分钟前）→ 不动它（不是 never-started 野鬼，是正常起步中）', async () => {
    mockPoolQuery.mockImplementation(async (sql) => {
      // simulate: the never-started SELECT itself applies the staleness filter in SQL,
      // so a fresh claim never even appears in rows — return empty for that query.
      if (/SELECT/i.test(sql) && /NOT\s+EXISTS/i.test(sql) && /initiative_runs/.test(sql)) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    const r = await resumeStalledHarnessDrivers({});
    expect(r.resumed).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-watchdog-never-started.test.js`
Expected: FAIL — no `NOT EXISTS`/`claimed_at` predicate exists yet in `resumeStalledHarnessDrivers`'s SQL, so the SQL-shape assertions fail and no `UPDATE tasks SET status='failed'` call happens.

- [ ] **Step 3: Commit (commit-1, test only)**

```bash
git add packages/brain/src/__tests__/harness-watchdog-never-started.test.js
git commit -m "test: add regression test for harness-watchdog never-started recovery (fabf6bd6)"
```

---

### Task 4: Implement harness-watchdog.js "never started" branch

**Files:**
- Modify: `packages/brain/src/harness-watchdog.js` (end of `resumeStalledHarnessDrivers`, currently ends around line 258-259 with the closing of the "区段 A" loop)

- [ ] **Step 1: Add 区段 C right before the function's final `return`**

Find the end of `resumeStalledHarnessDrivers` — after the 区段 A `for` loop closes (right before the function's closing `}` and its final `return { resumed, scanned };` — read the file first to get the exact current final lines, since the earlier read stopped at line 259). Insert a new section there:

```javascript
  // ── 区段 C：从未真正开始（fabf6bd6）——claim 成功、status=in_progress，但连
  // initiative_runs 行都没有，说明 graph 从未被 invoke（dispatcher 侧异常吞掉了）。
  // 区段 A/B 都靠 JOIN/EXISTS initiative_runs 判活，这类任务对它们完全不可见。
  // 没有 checkpoint 可续 → 不是 resume，直接标 failed 释放 claim，让上游/用户重新点火。
  const neverStartedThresholdMin = staleMinutesA; // 复用 A 阶段阈值，不新增参数
  const neverStarted = await dbPool.query(
    `SELECT t.id
       FROM tasks t
      WHERE t.task_type = 'harness_initiative'
        AND t.status = 'in_progress'
        AND NOT EXISTS (SELECT 1 FROM initiative_runs ir WHERE ir.initiative_id = t.id)
        AND t.claimed_at IS NOT NULL
        AND t.claimed_at < NOW() - ($1 || ' minutes')::interval
      ORDER BY t.claimed_at ASC
      LIMIT 20`,
    [String(neverStartedThresholdMin)]
  );
  scanned += neverStarted.rows.length;

  for (const row of neverStarted.rows) {
    try {
      const upd = await dbPool.query(
        `UPDATE tasks SET
           status = 'failed',
           claimed_by = NULL,
           claimed_at = NULL,
           error_message = 'harness_initiative never started graph (no initiative_runs row, claimed_at stale)',
           updated_at = NOW()
         WHERE id = $1 AND status = 'in_progress'
         RETURNING id`,
        [row.id]
      );
      if (upd.rows.length > 0) {
        resumed.push(row.id);
        console.warn(
          `[harness-watchdog] marked never-started harness task failed: task=${row.id} ` +
          `(no initiative_runs row, claimed_at stale >${neverStartedThresholdMin}min)`
        );
      }
    } catch (err) {
      console.error(
        `[harness-watchdog] mark never-started failed (task=${row.id}) (non-fatal): ${err.message}`
      );
    }
  }

  return { resumed, scanned };
}
```

Remove whatever the old final `return { resumed, scanned };` + closing `}` was, replacing it with the block above (which ends with the same return + closing brace).

- [ ] **Step 2: Run test to verify it passes**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-watchdog-never-started.test.js`
Expected: PASS

- [ ] **Step 3: Run full harness-watchdog test suite to check for regressions**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-watchdog.test.js src/__tests__/harness-driver-heartbeat-watchdog.test.js src/__tests__/harness-watchdog-gan-stall.test.js src/__tests__/harness-watchdog-loop.test.js src/__tests__/zombie-reaper.test.js src/__tests__/zombie-cleaner.test.js src/__tests__/zombie-sweep.test.js`
Expected: PASS (all). These existing tests mock `mockPoolQuery` with `mockImplementation(async () => ({rows: []}))` as a catch-all default in most cases — the new 区段 C query will also hit that default and return `[]`, so it should not change their assertions. If any test's mock only matches on `/SELECT/i` too broadly and returns non-empty rows unexpectedly for the new query, tighten that test's SQL matcher (e.g., add `&& /B_task_loop/.test(sql)` guards) rather than changing the new production code.

- [ ] **Step 4: Commit (commit-2, implementation)**

```bash
git add packages/brain/src/harness-watchdog.js
git commit -m "fix(brain): recover harness_initiative tasks that never started a graph (fabf6bd6)"
```

---

### Task 5: DevGate + full brain test suite

- [ ] **Step 1: Run DevGate**

```bash
node scripts/facts-check.mjs && bash scripts/check-version-sync.sh
```
Expected: both exit 0 / print success. If red, fix whatever drift was introduced (should be none — this PR doesn't touch DEFINITION.md-tracked facts or version files) before continuing.

- [ ] **Step 2: Run full brain unit test suite**

```bash
cd packages/brain && npx vitest run src/__tests__/
```
Expected: PASS (or same pre-existing failures as `main`, if any — do not introduce new failures).

---

### Task 6: Manual real-world verification (proven-to-fire)

- [ ] **Step 1: Prove the dispatcher fix actually fires**

This is the "故意制造一次 spawn 失败，看到它被正确标记 failed 并释放槽位" verification from the issue's completion checklist. Since we can't easily inject a live exception into production `dispatchNextTask` safely, do this via the already-written unit test as the proof artifact (already exercises the exact failure mode with a real assertion, not a mock that always passes) — re-run it once more standalone and paste the PASS output into the PR description:

```bash
cd packages/brain && npx vitest run src/__tests__/dispatcher-claim-leak.test.js src/__tests__/harness-watchdog-never-started.test.js --reporter=verbose
```

Expected: both files PASS with the specific assertions shown (not just "1 passed" — verbose output should show the individual `it(...)` descriptions passing, which is the "亲眼看它报红过一次后又变绿" evidence for this bug class).

---

### Task 7: Push, PR, ship

- [ ] **Step 1: Push branch (background — pre-push hook runs quickcheck.sh, can take 5-10 min)**

```bash
git push -u origin cp-0702093929-fix-dispatcher-claim-leak
```
Run this with `run_in_background: true` in the Bash tool call. Wait for the notification, don't poll.

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "fix(brain): dispatcher claim leak causes permanent harness_initiative deadlock (fabf6bd6)" --body "$(cat <<'EOF'
## Summary
- Fixes Notion issue fabf6bd6: harness_initiative tasks could get claimed + marked in_progress, then permanently deadlock if any unexpected exception fired before the graph actually invoked (no process, no graph log, initiative_runs=0 — matches the reported symptom exactly).
- Root cause 1: `dispatchNextTask()` had no top-level try/catch after the atomic claim — added one that releases the claim and marks the task failed instead of leaking it forever.
- Root cause 1b (found adjacent while reading the code): the `execResult.success === false` path reverted status to `queued` but never cleared `claimed_by` — same deadlock family, fixed alongside.
- Root cause 2: `harness-watchdog.js::resumeStalledHarnessDrivers()` already recovers stalled graphs via heartbeat, but every query requires an existing `initiative_runs` row — a task that never even got that far was invisible to it. Added a new branch for exactly that case.
- Ruled out: the issue's "schema drift (retry_count column missing)" theory — verified via `psql \d checkpoints` / `\d initiative_runs` against migrations 244/238, no code path depends on a `retry_count` column on either table. No staging brain rebuild needed.

## Test plan
- [x] `dispatcher-claim-leak.test.js` — new regression test, proves claim is released + task marked failed on mid-flight exception
- [x] `harness-watchdog-never-started.test.js` — new regression test, proves never-started harness tasks get recovered
- [x] Full brain unit test suite green
- [x] DevGate green (facts-check.mjs + check-version-sync.sh)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: engine-ship then engine-pr-watchdog**

Per repo convention: after push+PR, invoke `Skill({"skill":"engine-ship"})`, then when it completes invoke `Skill({"skill":"engine-pr-watchdog"})` and block until merged (no `ScheduleWakeup`, no background polling of the watchdog itself).

---

### Task 8: Close the loop — Notion issue + HANDOFF.md

- [ ] **Step 1: Close Notion issue fabf6bd6**

After the PR is merged, update the issue status to Closed with the PR URL (use whatever Notion/Brain API path `notion-create-issue.js`'s sibling update command uses, or the Brain API issues endpoint directly — check `packages/brain/src/routes/` for a PATCH issues route; if none exists, update via the `notion` skill).

- [ ] **Step 2: Update HANDOFF.md**

Edit `docs/current/harness-verify-redesign/HANDOFF.md` section 5 ("下一步"): mark the dispatcher deadlock bug (fabf6bd6) as fixed, link the merged PR, and note that the schema-drift theory was investigated and ruled out (so nobody re-investigates it). Commit directly (docs change, no /dev needed per repo convention: "文档不用 /dev，直接改直接 commit") — but since this repo's branch is still checked out for this PR, either fold this into the same PR before merge, or do it as a quick separate main-branch commit after merge (not on main directly if still mid-PR — fold into this PR is simpler).
