# Kernel Stale Attempt Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `terminal run ⇒ zero active attempts` an enforced transactional invariant and safely reconcile the ten production attempts whose leases expired under already-failed runs.

**Architecture:** Attempt creation takes a key-share lock on an active exact `run_id`, so it serializes with run finalization and cannot be born after the run becomes terminal. Finalization locks `task → run → ordered attempts`, terminalizes any still-active attempts in the same transaction, and the historical CLI reuses that lock order with dry-run-first, reviewed-plan, exact-database, single-flight, and immutable-audit guards.

**Tech Stack:** Node.js ESM, PostgreSQL row/advisory locks, Vitest unit tests, real PostgreSQL integration tests, JSONL audit receipts.

---

### Task 1: Lock the invariant into the PRD and Red tests

**Files:**
- Modify: `docs/superpowers/specs/2026-07-30-kernel-harness-control-plane-convergence-repair-prd.md`
- Modify: `packages/brain/src/orchestrator/__tests__/attempt-store.test.js`
- Modify: `packages/brain/src/orchestrator/__tests__/kernel-run-store.test.js`
- Modify: `packages/brain/src/__tests__/integration/kernel-run-store.pg.integration.test.js`

- [ ] **Step 1: Add the missing invariant**

Add: a terminal v2 run has no `queued/starting/running` attempt; attempt creation must prove and lock an exact nonterminal run.

- [ ] **Step 2: Write Red unit tests**

Assert that `createAttempt()` refuses a missing/terminal run and that `finalizeKernelRun()` uses the order `task-lock → run-lock → attempt-lock → attempt-terminalize` and reports the count.

- [ ] **Step 3: Write Red PostgreSQL race tests**

Create real `harness_attempts` fixtures and prove the old code:

1. leaves a running attempt active after finalization;
2. can insert an attempt for a terminal run;
3. does not enforce serialization between attempt creation and finalization.

- [ ] **Step 4: Run Red**

Run:

```bash
cd packages/brain
npx vitest run \
  src/orchestrator/__tests__/attempt-store.test.js \
  src/orchestrator/__tests__/kernel-run-store.test.js
npx vitest run \
  src/__tests__/integration/kernel-run-store.pg.integration.test.js \
  --config vitest.integration.config.js
```

Expected: the new assertions fail because attempt creation has no run guard and finalization does not touch active attempts.

- [ ] **Step 5: Commit Red**

```bash
git add docs/superpowers/specs/2026-07-30-kernel-harness-control-plane-convergence-repair-prd.md \
  packages/brain/src/orchestrator/__tests__/attempt-store.test.js \
  packages/brain/src/orchestrator/__tests__/kernel-run-store.test.js \
  packages/brain/src/__tests__/integration/kernel-run-store.pg.integration.test.js
git commit -m "test(kernel): expose terminal run attempt leak (Red)"
```

### Task 2: Guard attempt creation at the exact run boundary

**Files:**
- Modify: `packages/brain/src/orchestrator/attempt-store.js`
- Modify: `packages/brain/src/orchestrator/__tests__/attempt-store.test.js`

- [ ] **Step 1: Add an active-run lock CTE**

Make the create SQL begin with:

```sql
WITH guarded_run AS (
  SELECT id
    FROM initiative_runs
   WHERE id = $2
     AND orchestrator_version = 'v2'
     AND phase NOT IN ('done','failed')
   FOR KEY SHARE
), inserted AS (
  INSERT INTO harness_attempts (...)
  SELECT ... FROM guarded_run
  ON CONFLICT (run_id, hop) DO NOTHING
  RETURNING *
)
```

Both the inserted row and idempotent winner read must require `guarded_run`. Concurrent-winner retry reads must join the same active exact run. If no guarded row/winner exists, throw `Kernel run is terminal or missing: <run_id>`.

- [ ] **Step 2: Run unit tests Green**

Run:

```bash
cd packages/brain
npx vitest run src/orchestrator/__tests__/attempt-store.test.js
```

Expected: all tests pass.

- [ ] **Step 3: Commit Green**

```bash
git add packages/brain/src/orchestrator/attempt-store.js \
  packages/brain/src/orchestrator/__tests__/attempt-store.test.js
git commit -m "fix(kernel): guard attempt creation by active run (Green)"
```

### Task 3: Close active attempts in run finalization

**Files:**
- Modify: `packages/brain/src/orchestrator/kernel-run-store.js`
- Modify: `packages/brain/src/orchestrator/__tests__/kernel-run-store.test.js`
- Modify: `packages/brain/src/__tests__/integration/kernel-run-store.pg.integration.test.js`

- [ ] **Step 1: Lock and terminalize attempts in the existing transaction**

After the exact run lock and terminal-outcome checks:

```sql
SELECT id
  FROM harness_attempts
 WHERE run_id = $1
   AND status IN ('queued','starting','running')
 ORDER BY id
 FOR UPDATE
```

Update only those locked IDs to:

```text
status=cancelled
error_code=parent_run_terminal
error_message=<run outcome/reason>
completed_at=COALESCE(completed_at,NOW())
lease_owner=NULL
lease_expires_at=NULL
updated_at=NOW()
```

Return `attemptsTerminalized` in the finalization receipt. The attempt lifecycle trigger remains the append-only database event authority.

- [ ] **Step 2: Verify the callback/finalize race**

The real PostgreSQL test must accept only these two serial outcomes:

1. callback commits first, finalization leaves the already-terminal attempt unchanged;
2. finalization commits first, the late callback is rejected as a terminal payload conflict.

It must never leave an active attempt or deadlock with `40P01`.

- [ ] **Step 3: Run Green**

Run:

```bash
cd packages/brain
npx vitest run src/orchestrator/__tests__/kernel-run-store.test.js
npx vitest run \
  src/__tests__/integration/kernel-run-store.pg.integration.test.js \
  --config vitest.integration.config.js
```

Expected: all tests pass.

- [ ] **Step 4: Commit Green**

```bash
git add packages/brain/src/orchestrator/kernel-run-store.js \
  packages/brain/src/orchestrator/__tests__/kernel-run-store.test.js \
  packages/brain/src/__tests__/integration/kernel-run-store.pg.integration.test.js
git commit -m "fix(kernel): terminalize attempts with parent run (Green)"
```

### Task 4: Add audited historical stale-attempt reconciliation

**Files:**
- Create: `packages/brain/scripts/kernel-stale-attempt-reconcile.mjs`
- Create: `packages/brain/src/__tests__/kernel-stale-attempt-reconcile.test.js`
- Create: `packages/brain/src/__tests__/kernel-stale-attempt-reconcile-production-guards.test.js`
- Create: `packages/brain/src/__tests__/integration/kernel-stale-attempt-reconcile.pg.integration.test.js`
- Modify: `packages/brain/vitest.config.js`
- Modify: `packages/brain/scripts/smoke/kernel-run-exact-api-smoke.sh`

- [ ] **Step 1: Write CLI Red tests**

Require:

- default dry-run;
- candidate = active attempt + exact terminal v2 parent + expired/null lease;
- live lease, active parent, or evidence drift = blocked/no mutation;
- apply requires absolute audit path, 64-hex plan SHA, exact proposal count, exact database confirmation;
- session advisory single-flight;
- canonical `task → run → attempt` row-lock order;
- JSONL audit is newly created read-only and contains before/after plus `commit_state=verified`;
- second dry-run proposes zero.

- [ ] **Step 2: Run CLI Red**

Run:

```bash
cd packages/brain
npx vitest run \
  src/__tests__/kernel-stale-attempt-reconcile.test.js \
  src/__tests__/kernel-stale-attempt-reconcile-production-guards.test.js
npx vitest run \
  src/__tests__/integration/kernel-stale-attempt-reconcile.pg.integration.test.js \
  --config vitest.integration.config.js
```

Expected: fail because the CLI does not exist.

- [ ] **Step 3: Implement the minimal CLI**

Export argument parsers, stable canonical plan hashing, candidate classification, and `reconcileStaleAttempts()`. Production apply processes one proposal per transaction, revalidates all evidence under locks, updates only the exact attempt, rereads it after commit, and appends a verified audit line. It never deletes history and never touches an unexpired lease.

- [ ] **Step 4: Register integration and exact smoke coverage**

Add the PG test to `POSTGRES_INTEGRATION_TESTS` and add all new test files to `kernel-run-exact-api-smoke.sh`.

- [ ] **Step 5: Run Green**

Run the commands from Step 2 and the exact smoke script. Expected: all pass and a second dry-run has `proposed=0` after a test apply.

- [ ] **Step 6: Commit Red then Green**

Commit the test-only failure first:

```bash
git commit -m "test(kernel): expose stale attempt reconcile gap (Red)"
```

Then commit implementation and registrations:

```bash
git commit -m "fix(kernel): audit stale attempt reconciliation (Green)"
```

### Task 5: Release, verify, review, and publish

**Files:**
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `package-lock.json`
- Modify: `packages/brain/DEFINITION.md`
- Modify: `.brain-versions`
- Modify: `DEFINITION.md`

- [ ] **Step 1: Bump Brain**

Bump `1.267.150 → 1.267.151` in every Brain version SSOT and document:

- active-run-guarded attempt creation;
- transactional attempt closure during run finalization;
- audited stale-attempt reconciliation.

- [ ] **Step 2: Run proportional verification**

Run exact smoke, real PostgreSQL race tests, ESLint for changed JS, version/facts/DoD/diff gates, and `git diff --check`.

- [ ] **Step 3: Request independent review**

Review the exact head SHA for identity safety, lock order, callback races, historical evidence guards, and scope. Fix every P0/P1 and rerun the relevant tests.

- [ ] **Step 4: Publish and merge**

Push the branch, create a draft PR, mark it ready after review, wait for all required GitHub checks, and squash merge without bypass/admin.

- [ ] **Step 5: Production operation**

With tick still manually disabled:

1. verify no fresh leases and no real Harness containers;
2. run stale-attempt dry-run and record plan SHA/count;
3. review the ten exact candidates;
4. apply with database confirmation and immutable audit path;
5. run a second dry-run and require zero;
6. deploy Brain `1.267.151`;
7. only restore tick after the three Fleet nodes are admitted and R16 is ready.
