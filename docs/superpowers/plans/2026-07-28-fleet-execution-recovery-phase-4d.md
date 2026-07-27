# Fleet Execution Equivalence and Recovery Phase 4D Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining Phase 4D wiring gaps without replacing the existing Commander/Fleet architecture: admit fully compliant Fleet nodes for dispatch, preserve execution-contract equivalence, make same-machine resume and cross-machine fresh recovery explicit, persist distinct failure classes, and recover normalized product-failure sets across Runs.

**Architecture:** Brain remains the US M4 control-plane authority. Existing NodeProfile/admission, TaskBundle, Worker API, WorkspaceSpec, CredentialEnvelope, Attempt ledger, decision log, and watchdog are extended in place. No provider session file crosses a machine boundary; prior failure sets are read only from the append-only decision log. Phase 5 deployment and real three-machine canary remain out of scope.

**Tech Stack:** Node.js ESM/CommonJS, Vitest, PostgreSQL additive migrations, Express, OrbStack/Docker Fleet Worker.

---

## Main audit and dependency graph

```text
Phase 4A NodeProfile + admission + health TTL
  └── Phase 4B unified Worker + WorkspaceSpec + restart cleanup
        └── Phase 4C US M4 CredentialEnvelope
              └── Phase 4D dispatch readiness + execution/recovery closure

Phase 0A/PR #4354/#4355 decision log durability
  └── Phase 4D cross-Run failure-set replay

Phase 0B ExecutionTarget/capability gate
  └── Phase 4D provider/runner/semantic failure classification
```

Existing `main` coverage to preserve:

- `node-admission-client.js` already bounds health evidence by TTL and forces fresh production probes.
- `dispatcher.js` already builds one TaskBundle containing model selection, role, frozen Skill, timeout, and expected result schema for every machine.
- `attempt-runner.cjs` already uses the same pinned Runner digest and forwards the same provider spec/model/role into every canonical Worker.
- `workspace-manager.cjs` and Worker startup reconciliation already clean terminal/orphan containers and worktrees.
- `harness-relay-watchdog.js` already resumes a durable provider session and otherwise restarts deterministic Kernel reconciliation from DB/Git/PR.
- `convergence-signatures.js`, `counters.js`, and the append-only decision log already normalize and persist per-Run failure sets.

Confirmed gaps:

1. Brain-owned admission still hard-codes `dispatch_ready=false` after every base-admitted report.
2. watchdog resume targets the requested machine instead of the receipt-proven actual machine and does not rewrite the child bundle to the explicit same-machine resume contract.
3. provider unavailability, Runner failure, and semantic refusal are not represented by one canonical Harness failure classifier.
4. `collectGroundTruth()` reads only the current Run's decision rows, so Run B cannot see Run A's normalized product-failure set.

## PR boundary

This Phase is one independent PR. It may modify only:

- `packages/brain/src/orchestrator/fleet-node/node-admission.js`
- `packages/brain/src/orchestrator/fleet-node/node-admission-client.js`
- their paired tests
- `packages/brain/src/orchestrator/preflight/production-wiring.test.js`
- `packages/brain/scripts/fleet-worker/fleet-nodectl.sh`
- `packages/brain/scripts/fleet-worker/fleet-nodectl.test.sh`
- `packages/brain/src/orchestrator/execution-contract.js`
- `packages/brain/src/orchestrator/__tests__/execution-contract.test.js`
- `packages/brain/src/routes/harness-callback.js`
- `packages/brain/src/routes/__tests__/harness-attempt-callback.test.js`
- `packages/brain/src/orchestrator/attempt-store.js`
- `packages/brain/src/orchestrator/__tests__/attempt-store.test.js`
- `packages/brain/migrations/366_kernel_harness_failure_class.sql`
- the migration test paired with migration 366
- `packages/brain/src/__tests__/integration/kernel-fleet-execution-receipts.integration.test.js`
- `packages/brain/src/harness-relay-watchdog.js`
- `packages/brain/src/__tests__/harness-relay-watchdog-kernel-fleet.test.js`
- `packages/brain/src/orchestrator/ground-truth.js`
- `packages/brain/src/orchestrator/__tests__/ground-truth.test.js`
- `packages/brain/src/orchestrator/counters.js`
- `packages/brain/src/orchestrator/__tests__/counters.test.js`
- `packages/brain/src/orchestrator/derive.js`
- `packages/brain/src/orchestrator/__tests__/derive.test.js`
- `packages/brain/src/orchestrator/__tests__/loop.test.js`
- `packages/brain/DEFINITION.md`
- `packages/brain/package.json`
- `packages/brain/package-lock.json`
- this plan.

No Commander redesign, provider credential fallback, machine deployment, local Xian Codex credential, or synthetic acceptance canary is allowed.

### Task 1: Turn verified base admission into dispatch readiness

**Red tests**

- [ ] In `node-admission.test.js`, change the healthy report assertion to require `dispatch_ready=true`.
- [ ] In `node-admission-client.test.js`, require the Brain-owned bounded result to preserve `dispatch_ready=true` only when local evaluation returns a clean `base_admitted` result.
- [ ] Add a negative assertion proving a Worker-supplied `dispatch_ready=true` cannot override a failed local evaluation.
- [ ] Run:

```bash
cd packages/brain
npx vitest run src/orchestrator/fleet-node/node-admission.test.js src/orchestrator/fleet-node/node-admission-client.test.js
```

Expected Red: healthy reports still return `dispatch_ready=false`.

**Implementation**

- [ ] Set `dispatch_ready` from Brain-owned admission outcome, never from Worker-provided claims, including the local `fleet-nodectl admit` evaluator.
- [ ] Preserve fail-closed behavior for malformed, stale, drifting, drained, or resource-insufficient evidence.
- [ ] Re-run the two tests and `preflight/production-probes.test.js`.

### Task 2: Make same-machine SessionStore resume and cross-machine fresh recovery explicit

**Red tests**

- [ ] In `harness-relay-watchdog-kernel-fleet.test.js`, add a receipt-proven fallback case where requested and actual machine differ; require resume to target the actual machine.
- [ ] Require the resumed child Attempt to use that actual machine and a cloned TaskBundle with `constraints.fresh_session=false`.
- [ ] Add a no-session restart case proving the watchdog launches Kernel reconciliation and does not create/resume a provider child Attempt; the next normal dispatcher contract remains `fresh_session=true`.
- [ ] Run:

```bash
cd packages/brain
npx vitest run src/__tests__/harness-relay-watchdog-kernel-fleet.test.js src/orchestrator/__tests__/dispatcher.test.js
```

Expected Red: the child currently targets `requested_machine_id` and reuses the original bundle unchanged.

**Implementation**

- [ ] Resolve same-machine resume from `actual_machine_id`, falling back only to legacy same-machine provenance when no receipt exists.
- [ ] Clone the child TaskBundle and set only `constraints.fresh_session=false`; do not copy private provider session files.
- [ ] Keep no-session recovery on deterministic Kernel restart so the dispatcher creates a fresh Attempt from DB/Git/PR with the same logical cycle evidence.
- [ ] Re-run the Red tests and Worker cleanup tests.

### Task 3: Persist one canonical Harness failure classification

**Red tests**

- [ ] In `execution-contract.test.js`, add a table proving:
  - provider HTTP 503 / unavailable error → `infrastructure_blocked`;
  - failed Runner/container lifecycle → `runner_failure`;
  - `blocked` or `needs_context` structured result → `semantic_refusal`.
- [ ] In `harness-attempt-callback.test.js`, prove the canonical class reaches the Attempt terminal write.
- [ ] In `attempt-store.test.js`, prove `failure_class` is persisted with `error_code` and `error_message`.
- [ ] Add migration 366 test asserting an additive nullable `harness_attempts.failure_class` column and bounded check constraint.
- [ ] Run:

```bash
cd packages/brain
npx vitest run src/orchestrator/__tests__/execution-contract.test.js src/routes/__tests__/harness-attempt-callback.test.js src/orchestrator/__tests__/attempt-store.test.js src/__tests__/migration-366-kernel-harness-failure-class.test.js
```

Expected Red: no canonical classifier or persisted `failure_class` exists.

**Implementation**

- [ ] Add a deterministic structured classifier in `execution-contract.js`; it must not inspect free-form natural-language messages.
- [ ] Keep original bounded error code/message for diagnostics while persisting the canonical class.
- [ ] Store every canonical class in both its canonical result/error payload and the Attempt column.
- [ ] Re-run the Red tests.

### Task 4: Recover normalized failure sets across Runs and stop before generator-fix

**Red tests**

- [ ] In `ground-truth.test.js`, require a second authoritative query that reads only prior Runs for the same `current_task_id`, only `spawn:generator-fix` rows with `failure_class=product_failure`, and never merges prior hops into the current decision log.
- [ ] In `counters.test.js`, pass a prior Run set with different ordering/duplicates and require the normalized current set to return `outcome=review`, `reason=failure_set_repeated_across_runs`.
- [ ] In `derive.test.js`, model Run B with no current fix intent and a matching prior set; require `{phase:'review', action:'wait:human_review'}`.
- [ ] In `loop.test.js`, prove Run B persists/dispatches only the human-review request and never dispatches `spawn:generator-fix`.
- [ ] Run:

```bash
cd packages/brain
npx vitest run src/orchestrator/__tests__/ground-truth.test.js src/orchestrator/__tests__/counters.test.js src/orchestrator/__tests__/derive.test.js src/orchestrator/__tests__/loop.test.js
```

Expected Red: prior Run rows are unavailable to `derive`, so Run B creates a generator-fix intent.

**Implementation**

- [ ] Query normalized prior failure-set evidence from `orchestrator_decision_log` joined to prior `initiative_runs` for the same task; exclude the current `run_id`.
- [ ] Return it as `historicalFailureSets`, separate from current `decisionLog`, so hop/callback/review lineage cannot cross-contaminate Runs.
- [ ] Extend `replayProductConvergence()` with a separate historical-set input and check exact normalized set equality before returning any fix route.
- [ ] Pass the field through `derive()` and retain backward compatibility for tests/legacy observations without it.
- [ ] Re-run the Red tests.

### Task 5: Version, verification, and PR

- [ ] Bump Brain patch version once and document Phase 4D behavior and rollback in `DEFINITION.md`.
- [ ] Run focused Phase 4D verification:

```bash
cd packages/brain
npx vitest run \
  src/orchestrator/fleet-node/node-admission.test.js \
  src/orchestrator/fleet-node/node-admission-client.test.js \
  src/orchestrator/preflight/production-probes.test.js \
  src/orchestrator/__tests__/execution-contract.test.js \
  src/orchestrator/__tests__/dispatcher.test.js \
  src/orchestrator/__tests__/attempt-store.test.js \
  src/routes/__tests__/harness-attempt-callback.test.js \
  src/__tests__/harness-relay-watchdog-kernel-fleet.test.js \
  scripts/fleet-worker/attempt-runner.test.cjs \
  scripts/fleet-worker/fleet-worker.test.js \
  src/orchestrator/__tests__/ground-truth.test.js \
  src/orchestrator/__tests__/counters.test.js \
  src/orchestrator/__tests__/derive.test.js \
  src/orchestrator/__tests__/loop.test.js
```

- [ ] Run relevant shell tests:

```bash
bash packages/brain/scripts/fleet-worker/fleet-nodectl.test.sh
bash packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh
```

- [ ] Run lint/DevGate commands required by the repository.
- [ ] Inspect `git diff --check`, scope, secret redaction, migration safety, and rollback notes.
- [ ] Commit, push, open one Phase 4D PR, self-review it, and handle required CI/review feedback autonomously.
- [ ] Do not deploy and do not claim the Phase 5 real three-machine acceptance canary.
