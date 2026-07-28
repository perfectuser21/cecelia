# Kernel Equivalence Quality Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real, isolated, seam-signed equivalence adapters for the five quality/runtime behaviors while keeping production proof blocked until secure runtime wiring exists.

**Architecture:** Five seam factories own effect signer ports and invoke the existing judge, liveness, DevGate, attempt-store, and report-learning code paths. A shared adapter registry owns only isolated resource lifecycle and passes signed seam output to `executeDrillCell`; an independent verifier confirms cleanup.

**Tech Stack:** Node.js ESM, Bash, Vitest, child processes, existing Kernel equivalence receipt verifier.

---

### Task 1: Adapter registry and isolation contract

**Files:**
- Create: `packages/brain/src/lib/__tests__/kernel-equivalence-quality-adapters.test.js`
- Create: `packages/brain/src/lib/kernel-equivalence-quality-adapters.js`

- [ ] Write failing tests requiring all five descriptors and all five adapter methods.
- [ ] Run `cd packages/brain && npx vitest run src/lib/__tests__/kernel-equivalence-quality-adapters.test.js`; expect module-not-found failure.
- [ ] Implement exact resource-prefix validation, AbortSignal propagation, signer-free observation, cancellation, cleanup, and independent inspection.
- [ ] Re-run the focused test; expect pass.
- [ ] Commit the red tests, then the minimal implementation in separate atomic commits.

### Task 2: Independent judge and liveness seams

**Files:**
- Modify: `packages/brain/src/orchestrator/__tests__/kernel-handlers.test.js`
- Modify: `packages/brain/src/orchestrator/kernel-handlers.js`
- Create: `packages/brain/src/lib/__tests__/kernel-equivalence-liveness-seam.test.js`
- Modify: `packages/brain/src/lib/kernel-liveness.js`

- [ ] Add failing tests for self-certification denial, independent success, uncertain cleanup denial, and confirmed-dead recovery.
- [ ] Run the focused tests and confirm expected missing-export/behavior failures.
- [ ] Add seam factories whose closed-over signer ports receive exact observed results after the actual handler/resolver runs.
- [ ] Re-run focused and existing judge/orphan tests; expect pass.
- [ ] Commit each seam red/green cycle atomically.

### Task 3: Guarded DevGate sidecar

**Files:**
- Create: `packages/engine/tests/devgate/kernel-equivalence-devgate-sidecar.test.ts`
- Create: `packages/engine/scripts/devgate/kernel-equivalence-devgate-sidecar.mjs`

- [ ] Add failing tests using real temporary Git repositories for valid, invalid, and corrected commit histories plus abort/late-effect behavior.
- [ ] Run `cd packages/engine && npx vitest run tests/devgate/kernel-equivalence-devgate-sidecar.test.ts`; expect module-not-found failure.
- [ ] Implement fixed-script guarded child execution. Pass only `BASE_REF`/`HEAD_REF`; retain signer in the parent.
- [ ] Re-run sidecar and existing DevGate tests; expect pass.
- [ ] Commit red and green separately.

### Task 4: Attempt ownership and report-learning seams

**Files:**
- Create: `packages/brain/src/orchestrator/attempt-store-equivalence.test.js`
- Modify: `packages/brain/src/orchestrator/attempt-store.js`
- Modify: `packages/brain/src/__tests__/auto-learning.test.js`
- Modify: `packages/brain/src/auto-learning.js`

- [ ] Add failing tests for owner success, foreign callback denial, recovery, stale evidence denial, and fresh report-learning closure.
- [ ] Run focused tests and confirm expected failures.
- [ ] Implement factories using the actual store completion authority, `spawnHarnessReport`, and `createAutoLearning`.
- [ ] Re-run focused and legacy tests; expect pass.
- [ ] Commit red and green separately.

### Task 5: Integration, definitions, and verification

**Files:**
- Modify: `packages/brain/src/lib/__tests__/kernel-equivalence-quality-adapters.test.js`
- Modify: `DEFINITION.md`
- Modify: `packages/brain/DEFINITION.md`
- Modify: Brain version files required by repository policy.

- [ ] Add `executeDrillCell` integration tests for fake receipt, stale grant, late effect, recovery lineage, and independent cleanup verification.
- [ ] Run focused tests and confirm each new assertion fails before implementation adjustment.
- [ ] Keep the root trust registry, blockers, proof matrix, and report unchanged at `0/99`.
- [ ] Run all touched Brain/Engine suites, version checks, and equivalence `--check`.
- [ ] Commit documentation/version synchronization atomically.
