# Kernel Review Class and Head Advance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent non-merge human approvals from opening the merge gate and allow verified PR-head advances to continue convergence safely.

**Architecture:** Derive a server-owned review class from the referenced request and carry it through the append-only decision log. Treat GitHub's current PR head as the convergence truth, with pending replay for unavailable verification, and make watchdog deadline pauses depend on the same current-head reconciliation.

**Tech Stack:** Node.js ESM, Express, PostgreSQL JSONB decision log, Vitest.

---

### Task 1: Separate merge-gate approval from repair approvals

**Files:**
- Create: `packages/brain/src/orchestrator/human-review-class.js`
- Modify: `packages/brain/src/routes/harness-kernel-approvals.js`
- Modify: `packages/brain/src/orchestrator/ground-truth.js`
- Modify: `packages/brain/src/orchestrator/derive.js`
- Test: `packages/brain/src/routes/__tests__/harness-kernel-approvals.test.js`
- Test: `packages/brain/src/orchestrator/__tests__/ground-truth.test.js`
- Test: `packages/brain/src/orchestrator/__tests__/derive.test.js`
- Test: `packages/brain/src/orchestrator/__tests__/kernel-callback-flow.integration.test.js`

- [ ] **Step 1: Write failing tests**

Add assertions that the route derives `review_class` from the referenced
request, an evidence approval on the current SHA leaves `reviewApproved=false`,
the referenced merge-gate approval makes it true, and unsigned evidence
approval unlocks one repair then fails on a repeated unsigned verdict.

- [ ] **Step 2: Run tests and verify Red**

Run:

```bash
cd packages/brain
npx --no-install vitest run \
  src/routes/__tests__/harness-kernel-approvals.test.js \
  src/orchestrator/__tests__/ground-truth.test.js \
  src/orchestrator/__tests__/derive.test.js \
  src/orchestrator/__tests__/kernel-callback-flow.integration.test.js \
  --reporter=verbose
```

Expected: assertion failures showing absent `review_class`, evidence approval
opening `reviewApproved`, and unsigned approval not unlocking repair.

- [ ] **Step 3: Commit Red**

```bash
git add packages/brain/src/routes/__tests__/harness-kernel-approvals.test.js \
  packages/brain/src/orchestrator/__tests__/ground-truth.test.js \
  packages/brain/src/orchestrator/__tests__/derive.test.js \
  packages/brain/src/orchestrator/__tests__/kernel-callback-flow.integration.test.js
git commit -m "test(kernel): expose human review class bypass (Red)"
```

- [ ] **Step 4: Implement the minimal fix**

Add a pure `reviewClassForReason(reason)` helper. The approval route derives the
class from `requestRow.detail.review_reason` and writes it to the verdict.
Ground truth validates the verdict's request hop and only materializes
`reviewApproved` for `merge_gate`. Extend unsigned evidence replay with the
same one-shot approval state machine used by signed evidence.

- [ ] **Step 5: Run the focused tests and verify Green**

Run the Step 2 command. Expected: all selected tests pass.

- [ ] **Step 6: Commit Green**

```bash
git add packages/brain/src/orchestrator/human-review-class.js \
  packages/brain/src/routes/harness-kernel-approvals.js \
  packages/brain/src/orchestrator/ground-truth.js \
  packages/brain/src/orchestrator/derive.js
git commit -m "fix(kernel): scope approvals to human review class"
```

### Task 2: Continue convergence when GitHub head advances

**Files:**
- Modify: `packages/brain/src/routes/harness-callback.js`
- Modify: `packages/brain/src/orchestrator/counters.js`
- Test: `packages/brain/src/routes/__tests__/harness-callback.test.js`
- Test: `packages/brain/src/orchestrator/__tests__/convergence-signatures.test.js`

- [ ] **Step 1: Write failing tests**

Cover a verified callback followed by current-head advance, a pending claimed
SHA lagging behind a newly resolved head, and a first callback whose run lacks
`pr_url`.

- [ ] **Step 2: Run tests and verify Red**

Run:

```bash
cd packages/brain
npx --no-install vitest run \
  src/routes/__tests__/harness-callback.test.js \
  src/orchestrator/__tests__/convergence-signatures.test.js \
  --reporter=verbose
```

Expected: `callback_sha_unverified` where continuation or pending is required.

- [ ] **Step 3: Commit Red**

```bash
git add packages/brain/src/routes/__tests__/harness-callback.test.js \
  packages/brain/src/orchestrator/__tests__/convergence-signatures.test.js
git commit -m "test(kernel): expose head advance false terminals (Red)"
```

- [ ] **Step 4: Implement the minimal fix**

At callback write time, mark resolver errors, missing `pr_url`, and a current
head already advanced beyond the trigger as `verification_pending`. During
replay, use the current verified head as progress whenever it differs from the
intent trigger; only reject a mismatched claim when the current head is still
the trigger.

- [ ] **Step 5: Run the focused tests and verify Green**

Run the Step 2 command. Expected: all selected tests pass.

- [ ] **Step 6: Commit Green**

```bash
git add packages/brain/src/routes/harness-callback.js \
  packages/brain/src/orchestrator/counters.js
git commit -m "fix(kernel): continue after verified head advance"
```

### Task 3: Reconcile watchdog review pauses with GitHub

**Files:**
- Modify: `packages/brain/src/harness-relay-watchdog.js`
- Test: `packages/brain/src/__tests__/harness-relay-watchdog.test.js`

- [ ] **Step 1: Write failing tests**

Assert that matching request/current SHA pauses cleanup, a confirmed mismatch
is collected, missing PR URL is collected, and resolver failure defers cleanup
until a later pass.

- [ ] **Step 2: Run test and verify Red**

Run:

```bash
cd packages/brain
npx --no-install vitest run src/__tests__/harness-relay-watchdog.test.js --reporter=verbose
```

Expected: SQL-only non-empty SHA exemption misclassifies at least the mismatch.

- [ ] **Step 3: Commit Red**

```bash
git add packages/brain/src/__tests__/harness-relay-watchdog.test.js
git commit -m "test(kernel): expose stale watchdog review pause (Red)"
```

- [ ] **Step 4: Implement the minimal fix**

Inject `resolvePrHead`, select overdue candidates with `pr_url`, query the
latest undecided request, and pause only when resolver output equals the
request SHA. Retry resolver errors on the next pass.

- [ ] **Step 5: Run the test and verify Green**

Run the Step 2 command. Expected: all watchdog tests pass.

- [ ] **Step 6: Commit Green**

```bash
git add packages/brain/src/harness-relay-watchdog.js
git commit -m "fix(kernel): verify watchdog review head"
```

### Task 4: Version, regression, and handoff

**Files:**
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `package-lock.json`
- Modify: `.brain-versions`
- Modify: `DEFINITION.md`

- [ ] **Step 1: Bump and synchronize the Brain patch version**

Increment the current main-relative patch version and update all four version
records.

- [ ] **Step 2: Run focused and permanent regression pools**

Run the three task commands, relay permanent pool, controlled Brain pool, and
`kernel-wiring.pg.integration.test.js`. Expected: all pass.

- [ ] **Step 3: Run static gates**

Run `facts-check`, version sync/bump, syntax, diff check, TDD order, and
`local-precheck`. Expected: all pass.

- [ ] **Step 4: Commit version synchronization**

```bash
git add packages/brain/package.json packages/brain/package-lock.json \
  package-lock.json .brain-versions DEFINITION.md
git commit -m "chore(brain): bump kernel review hardening version"
```

- [ ] **Step 5: Push and wait for GitHub rollup**

Push without bypassing hooks. Require zero failed or pending checks and verify
the generic auto-merge job remains skipped.

- [ ] **Step 6: Write the PR handoff comment**

Record every Red/Green pair, exact test counts, GitHub rollup, remaining known
baseline issues, and confirm the PR remains OPEN and unmerged.
