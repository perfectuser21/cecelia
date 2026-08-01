# Kernel Judge Bundle Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the independent Kernel Judge consume the approved contract and PRD embedded in provider-neutral Fleet bundles without restoring host paths.

**Architecture:** Thread immutable `contract_content` and `prd_content` from `task_bundle.inputs.contract` through the Kernel Judge handler into evidence collection. Embedded text is authoritative when present; filesystem reads remain a compatibility fallback. Judge eligibility depends on parsed evidence, not on a host worktree path.

**Tech Stack:** Node.js ESM, Vitest, PostgreSQL-backed Brain runtime.

---

### Task 1: Add the Fleet-bundle regression test

**Files:**
- Modify: `packages/brain/src/orchestrator/__tests__/judge-default-assembly.integration.test.js`
- Modify: `packages/brain/src/orchestrator/__tests__/kernel-handlers.test.js`

- [ ] **Step 1: Write a failing default-assembly test**

Add a case whose bundle omits `worktree_path` and supplies:

```js
contract: {
  contract_content: '## E2E 验收\n- embedded contract check\n',
  prd_content: '## Golden Path\n1. embedded fleet step\n',
},
```

Invoke `spawn:judge` with an Evaluator PASS and assert `modelBoundary` runs once, its prompt contains `embedded contract check` and `embedded fleet step`, and the handler returns `{ status: 'DONE', detail: 'judge:PASS' }`.

- [ ] **Step 2: Assert the handler threads version-locked evidence**

In `kernel-handlers.test.js`, construct a Fleet-style context with no `worktree_path` and assert the `judgeGate` input contains:

```js
contractText: '## E2E 验收\nembedded',
prdText: '## Golden Path\n1. embedded',
```

- [ ] **Step 3: Verify RED**

Run:

```bash
cd packages/brain
npx vitest run \
  src/orchestrator/__tests__/judge-default-assembly.integration.test.js \
  src/orchestrator/__tests__/kernel-handlers.test.js
```

Expected: the new tests fail because the model boundary is not called and `judgeGate` receives neither embedded text field.

- [ ] **Step 4: Commit Red evidence**

```bash
git add packages/brain/src/orchestrator/__tests__/judge-default-assembly.integration.test.js \
  packages/brain/src/orchestrator/__tests__/kernel-handlers.test.js
git commit -m "test(brain): reproduce Fleet Judge evidence loss"
```

### Task 2: Implement embedded Judge evidence

**Files:**
- Modify: `packages/brain/src/orchestrator/kernel-handlers.js`
- Modify: `packages/brain/src/harness-judge.js`

- [ ] **Step 1: Thread evidence from the bundle**

In `spawn:judge`, derive `const contract = ctx.bundle.inputs.contract ?? {}` and pass:

```js
contractText: contract.contract_content ?? null,
prdText: contract.prd_content ?? null,
```

to `deps.judgeGate`.

- [ ] **Step 2: Prefer embedded content and retain fallback**

Extend `collectEvidence` to accept `contractText` and `prdText`. Normalize non-string values to empty strings. Only attempt filesystem reads for whichever text is still empty.

- [ ] **Step 3: Remove the host-path prerequisite from the evidence gate**

Change the evidence gate to skip only when both parsed `contractE2E` is empty and `goldenPathSteps` is empty. Do not weaken stage facts or mechanical gates.

- [ ] **Step 4: Verify GREEN and compatibility**

Run:

```bash
cd packages/brain
npx vitest run \
  src/orchestrator/__tests__/judge-default-assembly.integration.test.js \
  src/orchestrator/__tests__/kernel-handlers.test.js \
  src/__tests__/harness-judge.test.js
```

Expected: 3 files pass; existing no-evidence skip test remains green.

- [ ] **Step 5: Commit implementation**

```bash
git add packages/brain/src/orchestrator/kernel-handlers.js \
  packages/brain/src/harness-judge.js
git commit -m "fix(brain): ground Fleet Judge from embedded contract"
```

### Task 3: Version and definition synchronization

**Files:**
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/DEFINITION.md`
- Modify: `DEFINITION.md`

- [ ] **Step 1: Bump Brain patch version**

Change `1.267.163` to `1.267.164` in the Brain package and both definition headers.

- [ ] **Step 2: Document the invariant**

Add a release note stating that Fleet bundles remain host-path-free, Judge consumes approved embedded contract/PRD content, filesystem evidence is compatibility-only, and evidence absence remains fail-safe.

- [ ] **Step 3: Run facts/version checks**

Run the repository's Brain definition/version validation commands discovered from CI and confirm exit 0.

- [ ] **Step 4: Commit metadata**

```bash
git add packages/brain/package.json packages/brain/DEFINITION.md DEFINITION.md
git commit -m "chore(brain): bump version to 1.267.164"
```

### Task 4: Verify, publish, deploy, and resume

**Files:**
- Verify all modified files and the committed design/plan.

- [ ] **Step 1: Run focused and affected suites**

Run the three focused test files, syntax checks for modified production modules, facts checks, and the normal Brain pre-PR gate. Record exact pass counts.

- [ ] **Step 2: Review the diff**

Confirm no dispatcher, Fleet transport, human review policy, database schema, or Zenithjoy product file changed.

- [ ] **Step 3: Push and open the Brain PR**

Push `fix/kernel-judge-bundle-evidence-0801`, open a PR describing recovery run `2f3e1837-b52e-444b-b351-b60a067b301c`, and wait for all current-head checks.

- [ ] **Step 4: Merge and deploy**

Squash merge only after all required checks pass. Verify production `/api/brain/health` reports Brain `1.267.164` and the merged SHA while global tick remains disabled.

- [ ] **Step 5: Resume from Evaluator evidence**

Create a new trusted recovery run that carries forward the exact PR SHA and approved contract v15, records recovery 11 as predecessor, and starts at Judge eligibility without rerunning Planner/Proposer/Generator. Run through independent Judge, Owner-approved human contract Gate, merge #1571, and verify run/task dual terminal state.

