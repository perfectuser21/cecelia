# Phase 4A macOS Admission Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the Phase 4A macOS admission policy so the supported Xian `15.6.1` nodes are not forced to upgrade solely to match the US M4 patch version.

**Architecture:** Keep the existing `version_policy.os` field as the minimum supported version and derive the supported macOS major from that floor. Admission remains fail-closed below the floor, for malformed versions, and outside macOS 15; the reconciler separately emits a non-blocking security recommendation for versions below `15.7.4`.

**Tech Stack:** Node.js ESM, Vitest, Bash, JSON NodeProfile registry.

---

### Task 1: Correct NodeProfile and admission semantics

**Files:**
- Modify: `packages/brain/src/orchestrator/fleet-node/node-admission.test.js`
- Modify: `packages/brain/src/orchestrator/fleet-node/node-profile.test.js`
- Modify: `packages/brain/src/orchestrator/fleet-node/node-admission.js`
- Modify: `packages/brain/src/orchestrator/fleet-node/node-profile.js`
- Modify: `packages/brain/config/fleet-node-profiles.json`

- [ ] **Step 1: Write failing tests**

Change the admission expectations so `15.6.1` and `15.7.4` are admitted,
`15.6.0` returns `os_version_below_floor`, and `16.0.0` returns
`os_version_drift`. Assert every canonical profile publishes `15.6.1`.

- [ ] **Step 2: Verify Red**

Run:

```bash
cd packages/brain
npx vitest run src/orchestrator/fleet-node/node-profile.test.js src/orchestrator/fleet-node/node-admission.test.js
```

Expected: FAIL because the canonical floor is still `15.7.4` and `15.6.1` is
still drained.

- [ ] **Step 3: Implement the minimum policy correction**

Set `version_policy.os` to `15.6.1` in the registry and canonical baseline.
Change admission's release boundary comparison from matching both major and
minor to matching the floor's major only.

- [ ] **Step 4: Verify Green**

Run the same Vitest command. Expected: both test files pass.

### Task 2: Separate support from security recommendation

**Files:**
- Modify: `packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.test.sh`
- Modify: `packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.sh`

- [ ] **Step 1: Write the failing shell contract**

Run the reconciler with observed `15.6.1` and assert it emits
`os_security_update_recommended recommended=15.7.4 observed=15.6.1`, does not
emit `os_version_below_floor`, and still completes reconciliation.

- [ ] **Step 2: Verify Red**

Run:

```bash
cd packages/brain
bash scripts/fleet-worker/reconcile-fleet-node-baseline.test.sh
```

Expected: FAIL because the current script treats `15.6.1` as below the floor.

- [ ] **Step 3: Implement the reconciler policy**

Set the supported floor to `15.6.1`, add the `15.7.4` recommendation, accept
all macOS 15 versions at or above the floor, and warn without exiting when the
observed version is below the recommendation.

- [ ] **Step 4: Verify Green**

Run the shell contract again. Expected: PASS.

### Task 3: Update smoke contract and Brain release metadata

**Files:**
- Modify: `packages/brain/scripts/smoke/provider-neutral-phase4a-node-smoke.sh`
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `packages/brain/DEFINITION.md`

- [ ] **Step 1: Update the production contract assertion**

Make the smoke require `version_policy.os === '15.6.1'`, while leaving Runner
digest and LaunchDaemon assertions unchanged.

- [ ] **Step 2: Version the Brain change**

Bump Brain from `1.267.103` to `1.267.104` in `package.json`,
`package-lock.json`, and `DEFINITION.md`. Add rollback instructions and state
explicitly that Phase 4B/4C/4D and Phase 5 remain out of scope.

- [ ] **Step 3: Run focused and full verification**

Run:

```bash
cd packages/brain
npx vitest run src/orchestrator/fleet-node/node-profile.test.js src/orchestrator/fleet-node/node-admission.test.js
bash scripts/fleet-worker/reconcile-fleet-node-baseline.test.sh
npm test
```

Expected: all commands exit zero with no failed tests.

- [ ] **Step 4: Review the diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and only the files listed by this plan are
modified or added.

