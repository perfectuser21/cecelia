# Kernel ReleaseRun Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable exact-SHA ReleaseRun that blocks Kernel report/done until staging and production are both verified.

**Architecture:** An append-only PostgreSQL ledger stores ReleaseRun identity, transitions, effect intents, and receipts. A deterministic executor holds one advisory lease across staging and production, reconciles external truth before replay, and advances only on exact evidence; the existing report handler consumes its terminal authority.

**Tech Stack:** Node.js ESM, PostgreSQL migrations, Vitest, dependency-injected effect adapters.

---

### Task 1: Freeze the ReleaseRun database contract

**Files:**
- Create: `packages/brain/migrations/374_kernel_release_runs.sql`
- Create: `packages/brain/src/orchestrator/__tests__/release-run-migration.test.js`

- [ ] Write a migration test that requires four tables, exact status/effect
  enums, unique axes, predecessor trigger, append-only triggers, exact SHA
  checks, and schema version 374.
- [ ] Run `cd packages/brain && npx vitest run src/orchestrator/__tests__/release-run-migration.test.js`
  and verify it fails because migration 374 is absent.
- [ ] Add the migration with `kernel_release_runs`,
  `kernel_release_transitions`, `kernel_release_effect_intents`, and
  `kernel_release_effect_receipts`.
- [ ] Run the focused test and verify it passes.
- [ ] Commit the RED test, then the GREEN migration.

### Task 2: Validate state and evidence

**Files:**
- Create: `packages/brain/src/orchestrator/release-run-contract.js`
- Create: `packages/brain/src/orchestrator/__tests__/release-run-contract.test.js`

- [ ] Write tests for exact SHA, sorted artifact records, exact predecessor
  transitions, staging PASS, full production evidence, and denial of
  skip/idle/unknown/unavailable/fail or partial evidence.
- [ ] Run the contract test and verify the missing module fails.
- [ ] Implement strict validation and stable artifact comparison without IO.
- [ ] Run the focused test and verify all cases pass.
- [ ] Commit RED and GREEN separately.

### Task 3: Persist authority under one lease

**Files:**
- Create: `packages/brain/src/orchestrator/release-run-store.js`
- Create: `packages/brain/src/orchestrator/__tests__/release-run-store.test.js`

- [ ] Write tests requiring a dedicated global session advisory lease, exact
  confirmed merge receipt load, immutable create/re-entry, ordered transition
  append, intent-before-effect persistence, and unique confirmed receipts.
- [ ] Run the store test and verify the missing module fails.
- [ ] Implement the PostgreSQL store using only parameterized SQL.
- [ ] Run the focused test and verify it passes.
- [ ] Commit RED and GREEN separately.

### Task 4: Reconcile staging and production effects

**Files:**
- Create: `packages/brain/src/orchestrator/release-run-executor.js`
- Create: `packages/brain/src/orchestrator/__tests__/release-run-executor.test.js`

- [ ] Write tests proving the exact six-state path, one shared lease,
  intent-before-effect, observation-after-effect, crash recovery without
  duplicate effects, idempotent verified replay, and fail-closed adapters.
- [ ] Run the executor test and verify the missing module fails.
- [ ] Implement deterministic staging and production reconciliation with
  bounded public receipts and persisted idempotency keys.
- [ ] Run the focused test and verify it passes.
- [ ] Commit RED and GREEN separately.

### Task 5: Hard-gate report and done

**Files:**
- Modify: `packages/brain/src/orchestrator/kernel-handlers.js`
- Modify: `packages/brain/src/orchestrator/run.js`
- Modify: `packages/brain/src/orchestrator/__tests__/kernel-handlers.test.js`
- Modify: `packages/brain/src/orchestrator/__tests__/run.test.js`

- [ ] Add tests that a missing, blocked, malformed, or non-terminal release
  result causes zero report/done side effects, while exact
  `production_verified` allows the existing chain.
- [ ] Run focused tests and verify current eager report behavior fails them.
- [ ] Invoke `releaseEffect` first, remove the eager Kernel `spawnStaging`
  ownership path, and assemble the default executor/store with optional
  server-owned adapters whose absence is fail-closed.
- [ ] Run focused tests and verify they pass.
- [ ] Commit RED and GREEN separately.

### Task 6: Close workflow and deploy API bypasses

**Files:**
- Create: `packages/brain/src/orchestrator/release-run-authorization.js`
- Create: `packages/brain/src/orchestrator/__tests__/release-run-authorization.test.js`
- Create: `packages/brain/src/orchestrator/__tests__/release-run-surfaces.test.js`
- Modify: `packages/brain/src/routes/ops.js`
- Modify: `packages/brain/src/routes/__tests__/ops.test.js`
- Modify: `packages/brain/src/cron/drift-sentinel.js`
- Modify: `packages/brain/src/cron/__tests__/drift-sentinel.test.js`
- Modify: `.github/workflows/deploy.yml`
- Modify: `.github/workflows/promote-all-prod.yml`
- Modify: `.github/workflows/promote-dashboard-prod.yml`
- Modify: `.github/workflows/brain-ci-deploy.yml`
- Modify: `.github/workflows/auto-staging-deploy.yml`

- [ ] Add failing tests that exact `release_run_id + merge_sha + effect_kind`
  authority is required before staging/production spawn, and that stale or
  wrong-state authority denies.
- [ ] Add adversarial static tests that detect schedule/push latest-main
  deployment, Fast Lane, skipped/idle success, unbound deploy JSON, distinct
  release concurrency groups, and drift-triggered deploy scripts.
- [ ] Run focused tests and verify the current legacy surfaces fail.
- [ ] Add the server-owned authorization consumer and gate both deploy API
  branches before any state mutation, receipt, log file, or child process.
- [ ] Require exact manual ReleaseRun inputs in release workflows, disable
  push/scheduled production deployment, share `kernel-release` concurrency,
  and make every unknown/skip/idle path fail.
- [ ] Convert drift sentinel from auto-remediation to detection/escalation.
- [ ] Run focused API, workflow, and sentinel tests and verify they pass.
- [ ] Commit RED and GREEN separately.

### Task 7: Publish versioned contract and verify

**Files:**
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `package-lock.json`
- Modify: `.brain-versions`
- Modify: `packages/brain/DEFINITION.md`
- Modify: `DEFINITION.md`

- [ ] Bump the Brain patch version consistently and document ReleaseRun,
  rollback, lease, receipt, and report boundary semantics.
- [ ] Run all new tests plus merge, Kernel handler, run assembly, version sync,
  and `git diff --check`.
- [ ] Confirm the worktree is clean after committing.
- [ ] Report base, HEAD, commit order, fresh test counts, and residual adapter
  risks without pushing, opening a PR, merging, or deploying.
