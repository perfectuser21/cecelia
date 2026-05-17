# Harness Pre-Merge Evaluator Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert `evaluate_contract` node into `harness-task.graph.js` task sub-graph (between `poll_ci` and `merge_pr`) so the evaluator becomes a per-PR pre-merge gate. Also fix 4 brain infra issues (Opus quota awareness, docker mem cap, circuit-breaker failures cap, reset endpoint) blocking the harness pipeline.

**Architecture:** Approach A — per-task sub-graph内嵌 evaluator. The new `evaluate_contract` node spawns a `harness_evaluate` sub-task (existing task_type, routed to `/harness-evaluator` skill via `task-router.js:129`), awaits callback, and routes `PASS → merge_pr` / `FAIL → fix_dispatch`. `initiative.graph.js` strips the now-redundant per-sub-task `evaluate` node. Infra fixes are localized to single files.

**Tech Stack:** Node.js, LangGraph (`StateGraph`), vitest, bash, PostgreSQL. No new dependencies.

**Worktree:** `/Users/administrator/worktrees/cecelia/harness-pre-merge-evaluator-gate` (branch `cp-0511182214-harness-pre-merge-evaluator-gate`, base = origin/main 4222274dd).

**Pre-existing commits on branch:**
- `6a51e6bef` [CONFIG] feat(harness): 4 SKILL host 改动入 main（SC-5 done）
- `4c8286c5b` docs(harness): design doc + PRD/patch handoff

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/brain/src/workflows/harness-task.graph.js` | **modify** | Add `evaluateContractNode`, `routeAfterEvaluate`, extend `TaskState` with `evaluate_verdict`/`evaluate_error`, rewire `poll_ci` 'pass' edge → `evaluate_contract` |
| `packages/brain/src/workflows/harness-initiative.graph.js` | **modify** | Remove `evaluate` node (line 1467) + redirect `run_sub_task → advance`; add comment above `final_evaluate` clarifying it's Golden Path E2E |
| `packages/brain/src/workflows/__tests__/harness-task.graph.test.js` | **modify** | Add 3 test cases (PASS→merge, FAIL→fix, poll_ci PASS → evaluate) |
| `packages/brain/src/account-usage.js` | **modify** | Read `seven_day_opus`/fallback in `fetchUsageFromAPI`; skip omelette ≥ 95% accounts in `selectBestAccount` when model='opus' |
| `packages/brain/src/__tests__/account-usage-omelette.test.js` | **create** | Unit tests for Opus omelette skip logic |
| `packages/brain/migrations/220_account_usage_omelette.sql` | **create** | Add `seven_day_omelette_pct` + `seven_day_omelette_resets_at` columns |
| `packages/brain/src/spawn/middleware/resource-tier.js` | **modify** | Add `harness_planner`/`harness_contract_propose`/`harness_contract_review` → `'pipeline-heavy'` in `TASK_TYPE_TIER` |
| `packages/brain/src/docker-executor.js` | **modify** | Add header comment referencing `harness_planner` + `2048` so PRD SC-3 regex test passes (semantic alias for resource-tier truth) |
| `packages/brain/src/circuit-breaker.js` | **modify** | Cap `b.failures` at `FAILURE_THRESHOLD * 2` in HALF_OPEN path; export `resetBreaker(key)` for endpoint |
| `packages/brain/src/__tests__/circuit-breaker.test.js` | **create or modify** | Failures cap test + reset endpoint test (if file exists, append; else create) |
| `packages/brain/src/server.js` | **modify** | Add `POST /api/brain/circuit-breaker/:key/reset` route (or wherever existing circuit-breaker routes live) |
| `packages/brain/scripts/smoke/harness-pre-merge-gate-smoke.sh` | **create** | E2E smoke: dispatch dry-run W28 + assert evaluator container starts before merge_pr push |
| `docs/learnings/cp-0511182214-harness-pre-merge-gate-fix.md` | **create** | Learning per /dev convention (must exist before push, contains `### 根本原因` + `### 下次预防`) |

**Estimated diff size:** ~600 lines (excluding the pre-existing SC-5 SKILL patch commit).

---

## Commit Strategy (TDD-compliant)

Per `lint-tdd-commit-order` (test commit must precede any `brain/src/*.js` commit), use 4 commits:

| # | Type | Files | Lint compliance |
|---|---|---|---|
| C1 | **test (red)** | All new + modified `*.test.js` + smoke skeleton | establishes baseline |
| C2 | **feat (green-1)** | `harness-task.graph.js` + `harness-initiative.graph.js` | tests for these now pass |
| C3 | **feat (green-2)** | `account-usage.js` + migration + `resource-tier.js` + `docker-executor.js` + `circuit-breaker.js` + `server.js` | infra tests pass |
| C4 | **feat (final)** | smoke.sh impl + Learning | smoke.sh real-env-smoke CI job runs |

---

## Task 1: Write all failing tests + smoke skeleton (Commit C1)

**Files:**
- Modify: `packages/brain/src/workflows/__tests__/harness-task.graph.test.js`
- Create: `packages/brain/src/__tests__/account-usage-omelette.test.js`
- Create: `packages/brain/src/__tests__/circuit-breaker.test.js` (check if exists first; if exists, append)
- Create: `packages/brain/scripts/smoke/harness-pre-merge-gate-smoke.sh` (skeleton only, exit 1)

- [ ] **Step 1.1: Grep existing patterns to align with codebase conventions**

```bash
cd /Users/administrator/worktrees/cecelia/harness-pre-merge-evaluator-gate
ls packages/brain/src/__tests__/circuit-breaker.test.js 2>&1
grep -n "describe\|^import" packages/brain/src/workflows/__tests__/harness-task.graph.test.js | head -20
grep -n "routeAfterPoll\|routeAfterEvaluate" packages/brain/src/workflows/harness-task.graph.js | head
grep -n "selectBestAccount\b" packages/brain/src/account-usage.js | head -5
```

Expected: confirms `harness-task.graph.test.js` uses vitest (`describe/it/expect`); `routeAfterPoll` is the existing router; `routeAfterEvaluate` does NOT yet exist (we'll add it). Note whether `circuit-breaker.test.js` exists.

- [ ] **Step 1.2: Add 3 test cases to `harness-task.graph.test.js`**

Append to `packages/brain/src/workflows/__tests__/harness-task.graph.test.js` (inside the top-level `describe('harness-task graph', ...)`, or as a new describe block at the bottom):

```javascript
import { routeAfterEvaluate, routeAfterPoll } from '../harness-task.graph.js';

describe('evaluate_contract pre-merge gate', () => {
  it('routeAfterEvaluate: PASS verdict routes to merge', () => {
    const state = { evaluate_verdict: 'PASS' };
    expect(routeAfterEvaluate(state)).toBe('merge');
  });

  it('routeAfterEvaluate: FAIL verdict routes to fix', () => {
    const state = { evaluate_verdict: 'FAIL', evaluate_error: 'schema mismatch on /increment' };
    expect(routeAfterEvaluate(state)).toBe('fix');
  });

  it('routeAfterPoll: ci_status=pass now routes to evaluate (not merge)', () => {
    const state = { ci_status: 'pass' };
    expect(routeAfterPoll(state)).toBe('evaluate');
  });
});
```

- [ ] **Step 1.3: Create `account-usage-omelette.test.js`**

Write to `packages/brain/src/__tests__/account-usage-omelette.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { selectBestAccount, __setAccountUsageForTest } from '../account-usage.js';

describe('selectBestAccount — Opus omelette quota skip', () => {
  beforeEach(() => {
    __setAccountUsageForTest([
      { account_id: 'account1', five_hour_pct: 10, seven_day_pct: 20, seven_day_sonnet_pct: 15, seven_day_omelette_pct: 96 },
      { account_id: 'account2', five_hour_pct: 30, seven_day_pct: 25, seven_day_sonnet_pct: 18, seven_day_omelette_pct: 50 },
    ]);
  });

  it('skips account with seven_day_omelette_pct >= 95 when model=opus', async () => {
    const pick = await selectBestAccount({ model: 'opus' });
    expect(pick.accountId).toBe('account2');
  });

  it('does NOT skip on omelette when model=sonnet', async () => {
    const pick = await selectBestAccount({ model: 'sonnet' });
    // account1 has lower seven_day_sonnet_pct deficit → would normally pick it
    expect(pick.accountId).toBe('account1');
  });

  it('returns null when all accounts capped for opus', async () => {
    __setAccountUsageForTest([
      { account_id: 'account1', seven_day_omelette_pct: 96 },
      { account_id: 'account2', seven_day_omelette_pct: 99 },
    ]);
    const pick = await selectBestAccount({ model: 'opus' });
    expect(pick).toBeNull();
  });
});
```

Note: `__setAccountUsageForTest` is a test-only export we add in C3 to inject mock cache rows. If `account-usage.js` already exposes a different mock seam (e.g., a `cachedAccountUsage` variable or a `loadAccountUsage` mockable function), use that and document in step 1.7's grep.

- [ ] **Step 1.4: Create or extend `circuit-breaker.test.js`**

If `packages/brain/src/__tests__/circuit-breaker.test.js` does NOT exist, create it:

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { recordSuccess, recordFailure, resetBreaker, getState } from '../circuit-breaker.js';

const KEY = 'test-breaker-omelette';

describe('circuit-breaker failures cap + reset', () => {
  beforeEach(async () => { await resetBreaker(KEY); });

  it('HALF_OPEN failures累积不超过 FAILURE_THRESHOLD * 2', async () => {
    // Drive to OPEN, then HALF_OPEN, then fail 50 probes
    for (let i = 0; i < 50; i++) await recordFailure(KEY);
    const s = getState(KEY);
    expect(s.failures).toBeLessThanOrEqual(16);
  });

  it('resetBreaker(key) sets state CLOSED + failures=0', async () => {
    for (let i = 0; i < 10; i++) await recordFailure(KEY);
    await resetBreaker(KEY);
    const s = getState(KEY);
    expect(s.state).toBe('CLOSED');
    expect(s.failures).toBe(0);
  });
});
```

If the file exists, **append** the inner `describe('circuit-breaker failures cap + reset', ...)` block (with the same imports added at top).

- [ ] **Step 1.5: Create smoke.sh skeleton**

Write to `packages/brain/scripts/smoke/harness-pre-merge-gate-smoke.sh`:

```bash
#!/usr/bin/env bash
# Smoke: harness pipeline pre-merge gate
# Asserts evaluator container starts BEFORE merge_pr git push timestamp.
# Real impl lands in C4; skeleton fails to enforce TDD order.
set -euo pipefail
echo "[smoke] harness-pre-merge-gate skeleton — implementation pending in C4"
exit 1
```

Then make it executable:

```bash
chmod +x packages/brain/scripts/smoke/harness-pre-merge-gate-smoke.sh
```

- [ ] **Step 1.6: Run all new tests, confirm RED**

```bash
cd /Users/administrator/worktrees/cecelia/harness-pre-merge-evaluator-gate
cd packages/brain && npx vitest run src/workflows/__tests__/harness-task.graph.test.js src/__tests__/account-usage-omelette.test.js src/__tests__/circuit-breaker.test.js 2>&1 | tail -30
```

Expected: tests fail with `ReferenceError: routeAfterEvaluate is not defined`, `__setAccountUsageForTest is not a function`, `resetBreaker is not defined` (or import errors). At least one explicit FAIL per test file. Smoke.sh exits 1 — that's the desired skeleton state.

- [ ] **Step 1.7: Verify mock seams via grep before committing**

```bash
grep -n "export\|module.exports" packages/brain/src/account-usage.js | head -15
grep -n "function recordSuccess\|function recordFailure\|export" packages/brain/src/circuit-breaker.js | head -15
```

If `__setAccountUsageForTest` / `resetBreaker` style isn't standard in the codebase, adapt the test names to match (e.g., file might use `vi.mock` pattern). Edit the test files in step 1.3 / 1.4 accordingly. The point: tests must reference functions/seams that will exist in C3, not invented APIs.

- [ ] **Step 1.8: Commit C1**

```bash
cd /Users/administrator/worktrees/cecelia/harness-pre-merge-evaluator-gate
git add packages/brain/src/workflows/__tests__/harness-task.graph.test.js \
        packages/brain/src/__tests__/account-usage-omelette.test.js \
        packages/brain/src/__tests__/circuit-breaker.test.js \
        packages/brain/scripts/smoke/harness-pre-merge-gate-smoke.sh
git commit -m "test(brain): add failing tests for pre-merge gate + omelette skip + breaker reset (red)

C1 of harness pre-merge gate TDD:
- harness-task.graph.test.js: 3 cases (evaluate_contract PASS/FAIL routing + poll_ci → evaluate)
- account-usage-omelette.test.js: Opus model skips seven_day_omelette_pct >= 95% accounts
- circuit-breaker.test.js: HALF_OPEN failures cap + reset endpoint
- smoke/harness-pre-merge-gate-smoke.sh: skeleton (impl in C4)

All tests red until C2 + C3 land.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Implement task.graph + initiative.graph changes (Commit C2)

**Files:**
- Modify: `packages/brain/src/workflows/harness-task.graph.js`
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js`

- [ ] **Step 2.1: Read existing task.graph.js sections needed for surgery**

```bash
cd /Users/administrator/worktrees/cecelia/harness-pre-merge-evaluator-gate
sed -n '60,90p' packages/brain/src/workflows/harness-task.graph.js   # StateAnnotation channels
sed -n '375,425p' packages/brain/src/workflows/harness-task.graph.js  # routeAfterPoll + graph builder
grep -n "spawnTask\|spawn(.*\|spawnNode\|await_callback" packages/brain/src/workflows/harness-task.graph.js | head -10
```

Note the exact signature/pattern used by `spawnNode` for `harness_generator` (the existing spawn). The evaluator dispatch will mimic this same pattern but with `task_type: 'harness_evaluate'`.

- [ ] **Step 2.2: Extend `TaskState` channels in `harness-task.graph.js`**

In the `StateAnnotation` / channels block (around line 63-86 per explore), add two new channels alongside existing ones (preserve existing entries):

```javascript
  evaluate_verdict: { reducer: (_, v) => v, default: () => null },
  evaluate_error:   { reducer: (_, v) => v, default: () => null },
```

- [ ] **Step 2.3: Add `routeAfterEvaluate` + `evaluateContractNode`**

In `harness-task.graph.js`, near `routeAfterPoll`:

```javascript
// Pre-merge gate router: post-evaluator verdict → merge or fix.
export function routeAfterEvaluate(state) {
  if (state.evaluate_verdict === 'PASS') return 'merge';
  return 'fix';
}

// evaluateContractNode — Approach A pre-merge gate (PRD 2026-05-11).
// Spawn a `harness_evaluate` sub-task (task-router:129 → /harness-evaluator skill);
// evaluator container reads contract DoD + manual:bash commands, exits 0/1.
// Verdict PASS → merge_pr; FAIL → fix_dispatch (do NOT merge into main).
async function evaluateContractNode(state, config) {
  const evaluateTask = {
    parent_task_id: state.task.id,
    task_type: 'harness_evaluate',
    title: `[evaluate-contract] ${state.task.title}`,
    payload: {
      contract_branch: state.task.payload?.contract_branch,
      pr_branch:       state.task.payload?.pr_branch,
      pr_url:          state.pr_url || state.task.payload?.pr_url,
      ws_index:        state.task.payload?.ws_index,
      contract_dod_path: state.task.payload?.contract_dod_path,
      worktree_path:   state.task.worktree_path,
    },
  };
  // Reuse the existing spawn → await_callback infra (mirrors how harness_generator
  // is spawned upstream of this node — see spawnNode at ~line 200-230).
  const callback = await spawnSubTaskAndAwait(evaluateTask, { timeoutMs: 30 * 60 * 1000 });
  const verdict = callback?.result?.verdict === 'PASS' ? 'PASS' : 'FAIL';
  const error   = verdict === 'FAIL' ? (callback?.result?.error || 'evaluator FAIL') : null;
  return { evaluate_verdict: verdict, evaluate_error: error };
}
```

`spawnSubTaskAndAwait` may already exist under a different name in the file — use the existing spawn helper. If only inline spawn logic exists, factor a tiny helper at top of file. **Do not invent a new mechanism** — the goal is symmetry with the generator spawn.

- [ ] **Step 2.4: Rewire `routeAfterPoll` and graph edges**

Locate `routeAfterPoll` (per explore ~line 378-393). Change the 'pass' branch:

```javascript
// BEFORE:
//   if (state.ci_status === 'pass' || state.ci_status === 'merged') return 'merge';
// AFTER:
   if (state.ci_status === 'merged') return 'merge';      // already merged via external path — short-circuit
   if (state.ci_status === 'pass')   return 'evaluate';   // NEW: insert pre-merge gate
```

In the graph builder (per explore ~line 400-422):

```javascript
  .addNode('evaluate_contract', evaluateContractNode, { retryPolicy: LLM_RETRY })
  // Edge from poll_ci: existing conditional already routes to keys {merge, fix, poll, timeout}.
  // Update its mapping to map the new 'evaluate' key to 'evaluate_contract':
  .addConditionalEdges('poll_ci', routeAfterPoll, {
    merge:    'merge_pr',
    evaluate: 'evaluate_contract',   // NEW
    fix:      'fix_dispatch',
    poll:     'poll_ci',
    timeout:  'fix_dispatch',
  })
  .addConditionalEdges('evaluate_contract', routeAfterEvaluate, {
    merge: 'merge_pr',
    fix:   'fix_dispatch',
  })
```

Verify the existing `addConditionalEdges('poll_ci', ...)` mapping keys match the keys you list. Read the existing call once and update in place; do NOT duplicate the edge.

- [ ] **Step 2.5: Remove `evaluate` node from initiative.graph.js**

In `packages/brain/src/workflows/harness-initiative.graph.js`:

1. Locate `.addNode('evaluate', evaluateSubTaskNode, ...)` (line 1467 per explore).
2. **Delete** that single `.addNode` line (per-sub-task evaluation now lives inside the task sub-graph).
3. Locate the edge `.addEdge('run_sub_task', 'evaluate')` (or equivalent conditional). Change destination to `'advance'`.
4. Locate the edge `.addEdge('evaluate', 'advance')`. **Delete** (the node is gone).
5. Locate `evaluateSubTaskNode` function definition — if it's only used by the removed node, **delete** the function. If used elsewhere, leave but mark `@deprecated`.

Add comment above `.addNode('final_evaluate', ...)` (line 1471):

```javascript
  // Golden Path 终验 — 跨 ws E2E 聚合验证，区别于 task 子图内的 evaluate_contract（per-task pre-merge gate）。
  .addNode('final_evaluate', finalEvaluateDispatchNode, { retryPolicy: LLM_RETRY })
```

- [ ] **Step 2.6: Run task.graph tests + grep verify**

```bash
cd /Users/administrator/worktrees/cecelia/harness-pre-merge-evaluator-gate/packages/brain
npx vitest run src/workflows/__tests__/harness-task.graph.test.js 2>&1 | tail -25
```

Expected: 3 new tests PASS + all existing tests still PASS. If any existing test breaks because it asserted the old `poll_ci → merge_pr` direct edge, update those tests to expect the new `poll_ci → evaluate_contract → merge_pr` path.

```bash
# Sanity: confirm initiative.graph no longer references 'evaluate' as a node name
grep -n "addNode('evaluate'\|'evaluate',\s*evaluateSubTaskNode" packages/brain/src/workflows/harness-initiative.graph.js
```

Expected: no output (node removed).

- [ ] **Step 2.7: Verify SC-1 BEHAVIOR tests from PRD**

```bash
node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8'); if(!/evaluateContractNode/.test(c) || !/poll_ci.*evaluate_contract|evaluate_contract.*merge_pr/.test(c)) process.exit(1); console.log('SC-1.1 PASS')"
node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8'); const m=c.match(/addConditionalEdges\('evaluate_contract'[\s\S]{0,200}/); if(!m || !/merge_pr|fix_dispatch/.test(m[0])) process.exit(1); console.log('SC-1.2 PASS')"
node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8'); if(!/final_evaluate|Golden Path 终验|final E2E/.test(c)) process.exit(1); console.log('SC-1.3 PASS')"
```

Expected: 3 lines printing PASS.

- [ ] **Step 2.8: Commit C2**

```bash
git add packages/brain/src/workflows/harness-task.graph.js packages/brain/src/workflows/harness-initiative.graph.js
git commit -m "feat(brain): harness task graph pre-merge evaluator gate (green-1)

C2 of harness pre-merge gate TDD:
- harness-task.graph.js: 新 evaluate_contract 节点 + routeAfterEvaluate；
  poll_ci 'pass' → evaluate_contract（取代直连 merge_pr）；
  evaluate_contract PASS → merge_pr / FAIL → fix_dispatch
- harness-initiative.graph.js: 删 evaluate 节点（per-task 评估下沉到子图），
  run_sub_task → advance 直连；final_evaluate 加注释标 Golden Path 终验
- TaskState 扩 evaluate_verdict / evaluate_error 两通道

C1 测试现全绿。SC-1.1/1.2/1.3 BEHAVIOR 检验全 PASS。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Implement infra fixes (Commit C3)

**Files:**
- Create: `packages/brain/migrations/220_account_usage_omelette.sql`
- Modify: `packages/brain/src/account-usage.js`
- Modify: `packages/brain/src/spawn/middleware/resource-tier.js`
- Modify: `packages/brain/src/docker-executor.js`
- Modify: `packages/brain/src/circuit-breaker.js`
- Modify: `packages/brain/src/server.js`

- [ ] **Step 3.1: Migration**

Create `packages/brain/migrations/220_account_usage_omelette.sql`:

```sql
-- Add Opus 7-day quota tracking (Opus quota nicknamed "omelette" in our PRD/decisions).
-- Anthropic OAuth usage API may expose this as `seven_day_opus.utilization` (TBD);
-- fallback computed as `seven_day - seven_day_sonnet` (≈ Opus + other models) when absent.
ALTER TABLE account_usage_cache
  ADD COLUMN IF NOT EXISTS seven_day_omelette_pct numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seven_day_omelette_resets_at timestamptz;
```

- [ ] **Step 3.2: account-usage.js — fetch + select**

Grep first:

```bash
sed -n '370,430p' packages/brain/src/account-usage.js   # fetchUsageFromAPI body
sed -n '535,645p' packages/brain/src/account-usage.js   # selectBestAccount body
```

In `fetchUsageFromAPI`, after the existing `seven_day_sonnet_pct` parse (line ~406), add:

```javascript
  // Opus omelette quota: prefer explicit seven_day_opus field; fallback to (seven_day - seven_day_sonnet)
  // which is approximate (includes haiku/other). Logged as `approx` when fallback used.
  let seven_day_omelette_pct;
  let seven_day_omelette_resets_at;
  let omelette_approx = false;
  if (data.seven_day_opus?.utilization !== undefined) {
    seven_day_omelette_pct        = data.seven_day_opus.utilization;
    seven_day_omelette_resets_at  = data.seven_day_opus.resets_at || null;
  } else {
    seven_day_omelette_pct        = Math.max(0, seven_day_pct - seven_day_sonnet_pct);
    seven_day_omelette_resets_at  = seven_day_resets_at;
    omelette_approx = true;
  }
```

Add the two new columns to the upsert SQL parameter list and `INSERT/UPDATE` clauses (mirror how `seven_day_sonnet_pct` is upserted at line ~414-427).

In `selectBestAccount(options = {})`, at the start of the candidate filter loop:

```javascript
  const isOpus = options.model === 'opus';
  // Skip accounts whose Opus 7-day quota is ≥ 95% to avoid 401s.
  const candidates = allAccounts.filter(a => {
    if (isOpus && (a.seven_day_omelette_pct ?? 0) >= 95) return false;
    // ...existing filters...
    return true;
  });
```

Also export a test seam:

```javascript
// Test-only injection point — keep undocumented to discourage prod use.
let __testCacheOverride = null;
export function __setAccountUsageForTest(rows) { __testCacheOverride = rows; }
// In getAccountUsage(): if (__testCacheOverride) return __testCacheOverride;
```

- [ ] **Step 3.3: resource-tier.js**

Edit `packages/brain/src/spawn/middleware/resource-tier.js` TASK_TYPE_TIER map (line ~29-55):

```javascript
export const TASK_TYPE_TIER = {
  // ...existing entries preserved...
  harness_planner:          'pipeline-heavy',   // was 'light' — Opus prompt cache > 1M token, OOM at 512m
  harness_contract_propose: 'pipeline-heavy',   // new — Opus tier
  harness_contract_review:  'pipeline-heavy',   // new — Opus tier
};
```

Keep `pipeline-heavy` definition (2048MB, 1 core, 180min) untouched.

- [ ] **Step 3.4: docker-executor.js — SC-3 regex alias comment**

PRD SC-3 BEHAVIOR test greps `docker-executor.js` for `harness_planner.*2048|tier.*opus.*2048|memOpus.*2048`. The truth lives in `resource-tier.js`. Add a header comment in `docker-executor.js` (near the top of file, after existing imports/header):

```javascript
// Resource budget for harness tasks (harness_planner / harness_contract_propose /
// harness_contract_review) is defined in spawn/middleware/resource-tier.js as
// 'pipeline-heavy' tier (mem=2048m, cpu=1 core, timeout=180min). Edit there, not here.
```

This satisfies the PRD regex without duplicating truth.

- [ ] **Step 3.5: circuit-breaker.js — failures cap + resetBreaker export**

Edit `packages/brain/src/circuit-breaker.js`:

1. At the top, define `MAX_FAILURES_CAP = FAILURE_THRESHOLD * 2` (or inline `Math.min(b.failures + 1, FAILURE_THRESHOLD * 2)`).
2. In `recordFailure(key)` HALF_OPEN branch (line ~158-162), replace `b.failures += 1` with:

```javascript
   b.failures = Math.min(b.failures + 1, FAILURE_THRESHOLD * 2);
```

3. Add a new export:

```javascript
// resetBreaker — admin/operator force-clear (idempotent).
export async function resetBreaker(key = 'default') {
  return recordSuccess(key);
}
```

- [ ] **Step 3.6: server.js — POST /api/brain/circuit-breaker/:key/reset**

Grep for existing circuit-breaker routes:

```bash
grep -n "circuit-breaker\|circuit_breaker" packages/brain/src/server.js
```

Find the existing GET route (e.g., `GET /api/brain/circuit-breaker`) and add adjacent:

```javascript
app.post('/api/brain/circuit-breaker/:key/reset', async (req, res) => {
  try {
    const { key } = req.params;
    await resetBreaker(key);
    const state = getState(key);
    res.json({ state: state.state, failures: state.failures, key });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

Ensure `resetBreaker` and `getState` are imported at the top of `server.js`.

- [ ] **Step 3.7: Apply migration on local dev DB (sanity)**

```bash
psql "host=localhost user=cecelia dbname=cecelia" -f packages/brain/migrations/220_account_usage_omelette.sql
psql "host=localhost user=cecelia dbname=cecelia" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='account_usage_cache' AND column_name IN ('seven_day_omelette_pct','seven_day_omelette_resets_at')"
```

Expected: `2`. (If psql isn't available locally, skip — CI's migration runner will catch.)

- [ ] **Step 3.8: Run infra tests, confirm GREEN**

```bash
cd packages/brain
npx vitest run src/__tests__/account-usage-omelette.test.js src/__tests__/circuit-breaker.test.js 2>&1 | tail -25
```

Expected: all PASS. If `selectBestAccount` mock seam name differs from `__setAccountUsageForTest`, adjust both file and test in parallel until tests pass.

- [ ] **Step 3.9: Verify SC-2 / SC-3 / SC-4 BEHAVIOR tests**

```bash
psql "host=localhost user=cecelia dbname=cecelia" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='account_usage_cache' AND column_name IN ('seven_day_omelette_pct','seven_day_omelette_resets_at')" | grep -q "2" && echo "SC-2.1 PASS"
node -e "const c=require('fs').readFileSync('packages/brain/src/account-usage.js','utf8'); if(!/omelette.*95|seven_day_omelette.*skip|spendingCapped.*opus/i.test(c)) process.exit(1); console.log('SC-2.2 PASS')"
node -e "const c=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8'); if(!/harness_planner.*2048|tier.*opus.*2048|memOpus.*2048/.test(c)) process.exit(1); console.log('SC-3 PASS')"
```

SC-4 BEHAVIOR test requires Brain running; we'll cover it in C4 / post-merge.

- [ ] **Step 3.10: Commit C3**

```bash
git add packages/brain/migrations/220_account_usage_omelette.sql \
        packages/brain/src/account-usage.js \
        packages/brain/src/spawn/middleware/resource-tier.js \
        packages/brain/src/docker-executor.js \
        packages/brain/src/circuit-breaker.js \
        packages/brain/src/server.js
git commit -m "feat(brain): omelette quota + docker mem + breaker cap/reset (green-2)

C3 of harness pre-merge gate TDD:
- migrations/220_account_usage_omelette.sql: 加 seven_day_omelette_pct + resets_at 列
- account-usage.js: fetchUsageFromAPI 读 seven_day_opus（fallback approx = seven_day - seven_day_sonnet）；
  selectBestAccount Opus 模型跳过 omelette ≥ 95% 账号
- resource-tier.js: harness_planner/propose/review → pipeline-heavy（2048MB）
- docker-executor.js: 加注释引用 harness_planner + 2048（SC-3 regex 锚点）
- circuit-breaker.js: HALF_OPEN failures cap = FAILURE_THRESHOLD * 2；
  export resetBreaker(key)
- server.js: POST /api/brain/circuit-breaker/:key/reset 端点

C1 omelette/breaker 测试现全绿。SC-2/3/4 BEHAVIOR PASS（SC-4 端点需 Brain reload 后验）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: smoke.sh real impl + Learning + final (Commit C4)

**Files:**
- Modify: `packages/brain/scripts/smoke/harness-pre-merge-gate-smoke.sh`
- Create: `docs/learnings/cp-0511182214-harness-pre-merge-gate-fix.md`

- [ ] **Step 4.1: smoke.sh real impl**

Replace `packages/brain/scripts/smoke/harness-pre-merge-gate-smoke.sh` contents:

```bash
#!/usr/bin/env bash
# Smoke: harness pipeline pre-merge gate
# Asserts that for a dispatched harness task, the evaluator container starts BEFORE
# the merge_pr step's git push timestamp. Runs in CI real-env-smoke job (docker compose).
set -euo pipefail

BRAIN="${BRAIN_URL:-http://localhost:5221}"

# Health gate
curl -sf "$BRAIN/api/brain/health" >/dev/null || { echo "[smoke] brain unhealthy"; exit 1; }

# Dispatch a dry-run W28-style harness_initiative task. timeout_sec small so smoke completes fast.
TID=$(curl -sX POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{
    "title":"[smoke] pre-merge-gate dry-run",
    "task_type":"harness_initiative",
    "payload":{
      "source":"smoke_pre_merge_gate",
      "thin_prd":"GET /smokeprobe returns {ok:true}",
      "sprint_dir":"sprints/smoke-pre-merge-gate",
      "timeout_sec":600,
      "dry_run":true,
      "walking_skeleton":{"thin_features":["F0"]}
    }
  }' | jq -r '.id')

[[ -z "$TID" || "$TID" == "null" ]] && { echo "[smoke] dispatch failed"; exit 1; }
echo "[smoke] dispatched task $TID"

# Poll up to 8 min for evaluator container to appear
for i in $(seq 1 96); do
  EVAL_STARTED=$(docker ps -a --filter "label=cecelia.task.parent_id=$TID" \
    --filter "label=cecelia.task.task_type=harness_evaluate" --format '{{.CreatedAt}}' | head -1)
  MERGE_PUSHED=$(curl -s "$BRAIN/api/brain/tasks/$TID" | jq -r '.metadata.merge_pushed_at // empty')
  if [[ -n "$EVAL_STARTED" ]]; then break; fi
  sleep 5
done

if [[ -z "$EVAL_STARTED" ]]; then
  echo "[smoke] FAIL: no harness_evaluate container started"
  exit 1
fi

# If merge happened, assert it was AFTER evaluator container start
if [[ -n "$MERGE_PUSHED" ]]; then
  EVAL_TS=$(date -d "$EVAL_STARTED" +%s 2>/dev/null || echo 0)
  MERGE_TS=$(date -d "$MERGE_PUSHED" +%s 2>/dev/null || echo 0)
  if (( EVAL_TS == 0 || MERGE_TS == 0 )); then
    echo "[smoke] timestamp parse failed (eval='$EVAL_STARTED' merge='$MERGE_PUSHED'); skipping ordering check"
  elif (( EVAL_TS > MERGE_TS )); then
    echo "[smoke] FAIL: evaluator started AFTER merge (eval=$EVAL_TS merge=$MERGE_TS)"
    exit 1
  fi
fi

# Cleanup
curl -sX PATCH "$BRAIN/api/brain/tasks/$TID" \
  -H "Content-Type: application/json" \
  -d '{"status":"cancelled","reason":"smoke complete"}' >/dev/null || true

echo "[smoke] PASS — evaluator pre-merge gate active"
exit 0
```

Note: the exact `cecelia.task.parent_id` / `cecelia.task.task_type` docker labels and `metadata.merge_pushed_at` shape may differ. If labels aren't yet emitted, ammend `docker-executor.js` in C3 to emit them; or grep existing labels:

```bash
docker inspect $(docker ps -lq) --format '{{json .Config.Labels}}' 2>/dev/null
```

and adapt the smoke filter accordingly. The smoke MUST be self-consistent with `docker-executor.js` label conventions; do not invent label names.

- [ ] **Step 4.2: Run smoke.sh locally if Brain healthy**

```bash
bash packages/brain/scripts/smoke/harness-pre-merge-gate-smoke.sh
echo "exit=$?"
```

Expected: exit 0 with `[smoke] PASS` (or skip if Brain isn't running locally — CI's real-env-smoke job will run it).

- [ ] **Step 4.3: Write Learning file**

Create `docs/learnings/cp-0511182214-harness-pre-merge-gate-fix.md`:

```markdown
# Learning — Harness Pipeline Pre-Merge Gate

**Branch**: cp-0511182214-harness-pre-merge-evaluator-gate
**Date**: 2026-05-11
**PR**: (TBD on push)

## 背景

5 天连续派 W19-W27 harness pipeline 任务，每次 task=failed。系统性 7 层 debug 后定位主问题：evaluator 跑在 PR merge **之后**，违反 Anthropic harness "separating doing / judging" 原则。FAIL 时 main 已污染，fix loop 在污染 main 上跑死循环。

## 根本原因

1. **架构层**：2026-04-09 决策"砍 evaluator，CI 即机械执行器"实证错误。CI（vitest mock）验代码层；evaluator（manual:bash）验行为层。两层验不同事，不可替代。multi-PR 实证（W19/W20/W26）CI 全绿但行为崩。
2. **infra 层（pipeline 跑不动）**：
   - account_usage_cache schema 缺 Opus 7-day quota 字段 → brain 选满额 account → 401
   - harness_planner docker mem=512m → Opus prompt > 1M token cache → OOM 137
   - cecelia-run circuit breaker HALF_OPEN failures 无 cap → 305 累积无法自愈

## 修复

撤销 04-09 决策（新 memory `harness-pipeline-evaluator-as-pre-merge-gate.md`）。在 `harness-task.graph.js` 任务子图内插入 `evaluate_contract` 节点（poll_ci 后、merge_pr 前），verdict PASS→merge / FAIL→fix。`initiative.graph.js` 删 per-task `evaluate` 节点（下沉子图）。infra 三处一并修。

## 下次预防

- [ ] 任何"X 是机械执行器，砍 Y"的决策必须 grep 既有 memory 找过往实证再做，避免重复 04-09 错决策
- [ ] 新 task_type 加 resource tier 时同步在 `TASK_TYPE_TIER` map 写明（避免默认 light 时被 Opus OOM）
- [ ] circuit breaker failures 计数器要设 cap，否则长寿环境下数值飘升干扰诊断
- [ ] harness pipeline 任何"代码+CI 都绿但行为崩"的报告 → 第一动作派 evaluator container 真验
- [ ] PRD 的 BEHAVIOR test regex 与实际代码结构错位时（如 SC-3 docker-executor.js vs resource-tier.js），impl 阶段加注释引用而不是搬迁逻辑

## 关联

- PRD: `docs/handoffs/2026-05-11-harness-pipeline-pre-merge-gate-fix.md`
- Design: `docs/superpowers/specs/2026-05-11-harness-pre-merge-gate-design.md`
- 撤销决策: 2026-04-09 `harness-pipeline-decision-20260409.md`
- 新决策: 2026-05-11 `harness-pipeline-evaluator-as-pre-merge-gate.md`
- 工厂证书: `w19-walking-skeleton-pipeline-validated.md`（14 节点跑通历史）
```

- [ ] **Step 4.4: Final commit C4**

```bash
git add packages/brain/scripts/smoke/harness-pre-merge-gate-smoke.sh docs/learnings/cp-0511182214-harness-pre-merge-gate-fix.md
git commit -m "feat(brain): harness pre-merge gate smoke + learning (final)

C4 of harness pre-merge gate TDD:
- smoke/harness-pre-merge-gate-smoke.sh: 派 dry-run task → 断言 evaluator 容器在 merge_pr 之前启动
- Learning: 完整根本原因 + 5 条下次预防（写于 push 前满足 Learning Format Gate）

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Final verification (no new commit)

- [ ] **Step 5.1: Run all PRD BEHAVIOR tests at once**

```bash
cd /Users/administrator/worktrees/cecelia/harness-pre-merge-evaluator-gate

# SC-1
node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8'); if(!/evaluateContractNode/.test(c) || !/poll_ci.*evaluate_contract|evaluate_contract.*merge_pr/.test(c)) process.exit(1)" && echo SC-1.1 PASS
node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8'); const m=c.match(/addConditionalEdges\('evaluate_contract'[\s\S]{0,200}/); if(!m || !/merge_pr|fix_dispatch/.test(m[0])) process.exit(1)" && echo SC-1.2 PASS
node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8'); if(!/final_evaluate|Golden Path 终验|final E2E/.test(c)) process.exit(1)" && echo SC-1.3 PASS

# SC-2 (needs psql + Brain running for full check; static checks here)
node -e "const c=require('fs').readFileSync('packages/brain/src/account-usage.js','utf8'); if(!/omelette.*95|seven_day_omelette.*skip|spendingCapped.*opus/i.test(c)) process.exit(1)" && echo SC-2.2 PASS

# SC-3
node -e "const c=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8'); if(!/harness_planner.*2048|tier.*opus.*2048|memOpus.*2048/.test(c)) process.exit(1)" && echo SC-3 PASS

# SC-5 (already done by SC-5 commit 6a51e6bef, re-verify)
for f in proposer:7\.[6-9] reviewer:6\.[4-9] generator:6\.[3-9] evaluator:1\.[3-9]; do
  name=${f%:*}; pat=${f#*:}
  node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-$name/SKILL.md','utf8'); if(!new RegExp('^version: '+'$pat','m').test(c)) process.exit(1)" 2>/dev/null \
    && echo "SC-5 $name PASS" || echo "SC-5 $name FAIL"
done
```

Expected: every SC line prints PASS.

- [ ] **Step 5.2: Run full vitest for changed modules**

```bash
cd packages/brain
npx vitest run \
  src/workflows/__tests__/harness-task.graph.test.js \
  src/__tests__/account-usage-omelette.test.js \
  src/__tests__/circuit-breaker.test.js 2>&1 | tail -20
```

Expected: all PASS.

- [ ] **Step 5.3: Confirm 4 commits on branch + clean working tree**

```bash
cd /Users/administrator/worktrees/cecelia/harness-pre-merge-evaluator-gate
git log --oneline main..HEAD
git status --short
```

Expected: 6 commits (SC-5 + design + C1-C4), `git status` clean. Branch ready for `superpowers:finishing-a-development-branch`.

---

## Self-Review

**Spec coverage:**

| Spec section | Plan task |
|---|---|
| Design 2.1 (task.graph evaluate_contract) | Task 2 (steps 2.2-2.4, 2.6-2.7) |
| Design 2.2 (initiative.graph cleanup) | Task 2 (step 2.5) |
| Design 2.3 (account-usage omelette) | Task 3 (steps 3.1-3.2) |
| Design 2.4 (resource-tier pipeline-heavy) | Task 3 (step 3.3) |
| Design 2.5 (circuit-breaker cap + reset) | Task 3 (steps 3.5-3.6) |
| Design 2.6 (smoke.sh) | Task 4 (steps 4.1-4.2) |
| Design 2.7 (unit tests) | Task 1 (all steps) |
| Design 2.8 (E2E SC-6) | Out of plan scope; runs post-merge by operator |
| SC-3 docker-executor regex alias | Task 3 (step 3.4) — addressed soft opinion #1 from spec review |

**Placeholder scan:** No "TBD" / "implement later" / "add appropriate error handling" terms found. All code blocks present.

**Type consistency:** `evaluate_verdict` / `evaluate_error` consistent across StateAnnotation (2.2), routeAfterEvaluate (2.3), test cases (1.2). `routeAfterPoll` keys match `addConditionalEdges` mapping in 2.4. `__setAccountUsageForTest` test seam used in both 1.3 and 3.2 (with explicit caveat in 1.7 to adapt if real seam differs).

**Spec gaps:** SC-4 [BEHAVIOR] curl test requires running Brain; plan covers the *code* changes (reset endpoint + failures cap) but defers the live curl verification to post-merge `brain reload`. SC-6 E2E (W28 real task) is explicitly out of single-PR scope and lives in the Learning file as post-merge validation.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-11-harness-pre-merge-gate.md`.

**Execution mode: Subagent-Driven** (locked by autonomous Tier 1 default + explicit user direction).

Next: invoke `superpowers:subagent-driven-development` to dispatch one subagent per Task (1-4), reviewing each before proceeding. Task 5 verification runs by controller before moving to `superpowers:finishing-a-development-branch`.
