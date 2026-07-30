# Kernel Harness Convergence PR3 — Async Callback Implementation Plan

> **For Codex:** Execute this plan task-by-task with Red→Green commits. PR3 is
> stacked on PR2 and must not merge before PR2 and the Controller exact-run
> cutover are merged.

**Goal:** Make asynchronous Worker launch and callback a first-class Kernel
state transition, fenced by the full attempt lease identity and projected from
one append-only callback event.

**Architecture:** Dispatcher persists the launch receipt and returns
`LAUNCHED`; Loop records that effect and waits. Worker callbacks cross a single
transactional Attempt Store boundary that locks the attempt, validates
`run_id + attempt_id + lease_owner + lease_generation`, writes its terminal
state, and appends `verdict:attempt_callback`. Derive consumes that structured
event and distinguishes completion, context requests, infrastructure blocks,
semantic refusals, cancellation, and repeated no-PR signatures.

**Tech Stack:** Node.js ESM, Express, PostgreSQL, Vitest, shell runner bridge.

---

## Task 1: Launch Is Not Completion (R7)

**Files:**

- Modify: `packages/brain/src/orchestrator/constants.js`
- Modify: `packages/brain/src/orchestrator/dispatcher.js`
- Modify: `packages/brain/src/orchestrator/loop.js`
- Test: `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`
- Test: `packages/brain/src/orchestrator/__tests__/loop.test.js`

**Red:**

1. Add a dispatcher assertion that a persisted launch receipt returns
   `status: LAUNCHED` with snake-case `run_id`, `attempt_id`,
   `lease_generation`, and `provider`.
2. Add a loop assertion that `LAUNCHED` appends
   `effect:attempt_launched`, heartbeats, and does not advance the role.
3. Run:

   ```bash
   cd packages/brain
   npx vitest run src/orchestrator/__tests__/dispatcher.test.js \
     src/orchestrator/__tests__/loop.test.js
   ```

4. Commit the failing tests.

**Green:**

1. Add `LOG_ACTION.ATTEMPT_LAUNCHED`.
2. Return the structured launch receipt from dispatcher after persistence.
3. Teach loop to append the launch effect and yield to callback/reconcile.
4. Run the focused tests and commit.

## Task 2: Propagate the Complete Lease Identity

**Files:**

- Modify: `packages/brain/src/orchestrator/dispatcher.js`
- Modify: `packages/brain/docker/cecelia-runner/entrypoint.sh`
- Modify: `packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs`
- Modify: `packages/brain/src/routes/harness-callback.js`
- Test: `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`
- Test: `packages/brain/src/routes/__tests__/harness-attempt-callback.test.js`

**Red:**

1. Assert every local/remote callback transport receives and sends
   `HARNESS_LEASE_GENERATION` / `X-Harness-Lease-Generation`.
2. Assert missing or malformed generation is rejected and a stale generation
   returns 409 without mutation.
3. Assert `needs_context` and unclassified `blocked` are not successful
   outcomes; only explicitly classified infrastructure blocks are eligible for
   failover.
4. Run the focused tests and commit the failing assertions.

**Green:**

1. Inject and forward lease generation through both callback transports.
2. Parse and validate the header at the callback boundary.
3. Extend structured result classification without inferring infrastructure
   from the word `blocked`.
4. Run focused tests and commit.

## Task 3: Atomic Terminal Callback Event (R8, R11, R12)

**Files:**

- Modify: `packages/brain/src/orchestrator/constants.js`
- Modify: `packages/brain/src/orchestrator/attempt-store.js`
- Modify: `packages/brain/src/routes/harness-callback.js`
- Test: `packages/brain/src/orchestrator/__tests__/attempt-store.test.js`
- Test: `packages/brain/src/routes/__tests__/harness-attempt-callback.test.js`
- Add: `packages/brain/src/__tests__/integration/kernel-callback-convergence.pg.integration.test.js`

**Red:**

1. Add PostgreSQL tests proving attempt terminal state and exactly one
   `verdict:attempt_callback` event commit together.
2. Prove stale generation and owner conflicts return 409 with no attempt,
   run, or decision mutation.
3. Prove an identical callback retry is an idempotent acknowledgement with one
   event; a conflicting terminal payload is rejected.
4. Prove `blocked` records `deny:BLOCKED` and `needs_context` records
   `deny:NEEDS_CONTEXT`.
5. Commit the failing tests.

**Green:**

1. Add `LOG_ACTION.ATTEMPT_CALLBACK`.
2. Implement one transaction in Attempt Store: lock attempt, verify full
   identity and current lease, distinguish exact duplicate from conflict,
   update terminal state, append the standard decision event, commit.
3. Replace route-level split writes with this store operation. Keep
   role-specific artifact projection after the authoritative event, but never
   use it as routing truth.
4. Run unit and real PostgreSQL tests and commit.

## Task 4: Derive From Callback Truth (R9, R10)

**Files:**

- Modify: `packages/brain/src/orchestrator/ground-truth.js`
- Modify: `packages/brain/src/orchestrator/counters.js`
- Modify: `packages/brain/src/orchestrator/derive.js`
- Modify: `packages/brain/src/orchestrator/loop.js`
- Test: `packages/brain/src/orchestrator/__tests__/derive.test.js`
- Test: `packages/brain/src/orchestrator/__tests__/loop.test.js`
- Test: `packages/brain/src/orchestrator/__tests__/kernel-replay-product.test.js`

**Red:**

1. Assert `needs_context` pauses once and never becomes `no_pr`.
2. Assert only `infrastructure_blocked` can enter budgeted Commander failover.
3. Assert semantic refusal cannot blind-retry on another machine/provider.
4. Assert a first structured no-PR signature may recover once, while the same
   signature a second time finalizes run/task failed and creates no third
   attempt.
5. Commit the failing tests.

**Green:**

1. Project the latest standard callback event into structured ground truth.
2. Route status/failure class according to PRD §7.4 and preserve the existing
   progress-evidence policy.
3. Persist the no-PR signature in append-only decisions and stop the second
   identical state.
4. Run focused replay and derive suites and commit.

## Task 5: Version, Regression, Review, and Integration

**Files:**

- Modify: `packages/brain/package.json`
- Modify: `packages/brain/DEFINITION.md`
- Modify: `packages/brain/src/DEFINITION.md`
- Modify: `CHANGELOG.md`
- Modify tests/docs only as required by verified failures.

1. Increment the Brain patch version in all three required locations.
2. Run focused suites from Tasks 1–4.
3. Run the explicit real-PostgreSQL integration suites.
4. Run Brain lint, definition/version facts, diff check, and the repository
   pre-push gate.
5. Request independent code review, resolve findings, and repeat verification.
6. Rebase onto merged PR2 if required, open the isolated PR3, repair CI, and
   squash merge only after every latest check is green.

## Exit Criteria

- R7–R12 all pass with unit and PostgreSQL evidence.
- Launch is never projected as role completion.
- Stale or conflicting callbacks cannot mutate attempt/run/decision state.
- Callback retry is idempotent.
- `needs_context`, infrastructure block, semantic refusal, no-PR, cancellation,
  and completion have distinct deterministic routes.
- PR3 does not include PR4 production reconciliation or R16 business canary.
