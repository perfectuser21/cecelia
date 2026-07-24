# Independent Judge Stage Evidence Hotfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the full evaluator evidence bridge and make independent-judge coverage stage-aware without weakening any mechanical or merge gate.

**Architecture:** Resolve the forensics directory once in the runtime assembly layer, pass it with server-derived stage facts through the kernel handler, and enforce premature-approval/merge failures deterministically before the LLM judge. The judge prompt uses the same facts to interpret post-judge Golden Path steps as sequencing preconditions.

**Tech Stack:** Node.js ESM, Vitest, PostgreSQL-backed ground truth, Docker evaluator forensics, Bash Brain smoke.

---

### Task 1: Lock the kernel evidence and stage-fact wiring

**Files:**
- Modify: `packages/brain/src/orchestrator/__tests__/kernel-handlers.test.js`
- Modify: `packages/brain/src/orchestrator/kernel-handlers.js`
- Modify: `packages/brain/src/orchestrator/run.js`

- [ ] **Step 1: Write the failing handler test**

Add a `spawn:judge` assertion that the real `judgeGate` call receives the
injected prompt directory and exact stage facts:

```js
expect(judgeGate).toHaveBeenCalledWith(
  expect.objectContaining({
    promptDir: '/host/cecelia-prompts',
    stageFacts: {
      current_stage: 'independent_judge',
      pr_state: 'OPEN',
      pr_merged: false,
      head_sha: HEAD_SHA,
      merge_gate_approved: false,
    },
  }),
  expect.any(Object),
);
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
cd packages/brain
npx vitest run src/orchestrator/__tests__/kernel-handlers.test.js --reporter=verbose
```

Expected: FAIL because `promptDir` and `stageFacts` are absent.

- [ ] **Step 3: Commit the Red test**

```bash
git add packages/brain/src/orchestrator/__tests__/kernel-handlers.test.js
git commit -m "test(judge): expose missing kernel stage evidence bridge (Red)"
```

- [ ] **Step 4: Implement the minimal wiring**

In `buildDefaultHandlers()`, inject `getHostPromptDir()` as `promptDir`.
In `spawn:judge`, pass `deps.promptDir` and construct `stageFacts` only from
`ctx.observed`.

- [ ] **Step 5: Run the test and verify GREEN**

Run the same Vitest command. Expected: all handler tests pass.

- [ ] **Step 6: Commit the wiring**

```bash
git add packages/brain/src/orchestrator/kernel-handlers.js packages/brain/src/orchestrator/run.js
git commit -m "fix(judge): wire evaluator forensics and stage facts"
```

### Task 2: Lock stage-aware fail-closed judge semantics

**Files:**
- Modify: `packages/brain/src/__tests__/harness-judge.test.js`
- Modify: `packages/brain/src/harness-judge.js`

- [ ] **Step 1: Write failing prompt and preflight tests**

Add tests that assert:

1. `buildJudgePrompt()` serializes `stageFacts` and explicitly treats
   post-judge actions as precondition checks.
2. The independent-judge stage passes only with `head_sha`, `pr_merged=false`,
   and `merge_gate_approved=false`.
3. Premature merge and premature merge-gate approval fail before `judgeFn`.

- [ ] **Step 2: Run the tests and verify RED**

```bash
cd packages/brain
npx vitest run src/__tests__/harness-judge.test.js --reporter=verbose
```

Expected: FAIL because stage facts are not in the prompt and no deterministic
stage preflight exists.

- [ ] **Step 3: Commit the Red tests**

```bash
git add packages/brain/src/__tests__/harness-judge.test.js
git commit -m "test(judge): expose post-judge timing paradox (Red)"
```

- [ ] **Step 4: Implement minimal stage semantics**

Add a focused stage-fact preflight, pass `stageFacts` through evidence/judge
input, and add the approved prompt rules. Do not change `validateCoverage()` or
the existing mechanical gate.

- [ ] **Step 5: Run focused and adjacent regression suites**

```bash
cd packages/brain
npx vitest run \
  src/__tests__/harness-judge.test.js \
  src/orchestrator/__tests__/kernel-handlers.test.js \
  src/orchestrator/__tests__/ground-truth.test.js \
  src/orchestrator/__tests__/human-review-class.test.js \
  --reporter=verbose
```

Expected: all tests pass.

- [ ] **Step 6: Commit the implementation**

```bash
git add packages/brain/src/harness-judge.js
git commit -m "fix(judge): enforce stage-aware independent review"
```

### Task 3: Add real smoke and version the Brain

**Files:**
- Create: `packages/brain/scripts/smoke/independent-judge-stage-evidence-smoke.sh`
- Modify: `.brain-versions`
- Modify: `DEFINITION.md`
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Add a smoke that invokes real exported judge helpers**

The smoke imports the production module, constructs valid and premature stage
facts, and asserts valid preconditions pass while premature merge/approval
fail.

- [ ] **Step 2: Run the smoke**

```bash
bash packages/brain/scripts/smoke/independent-judge-stage-evidence-smoke.sh
```

Expected: exit 0 with three explicit PASS assertions.

- [ ] **Step 3: Select and apply the next unused Brain patch version**

Check open PRs and `.brain-versions`, then update all required ledgers without
rewriting history.

- [ ] **Step 4: Run version and repository gates**

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit smoke and version**

```bash
git add packages/brain/scripts/smoke/independent-judge-stage-evidence-smoke.sh \
  .brain-versions DEFINITION.md packages/brain/package.json \
  packages/brain/package-lock.json package-lock.json
git commit -m "chore(brain): ship independent judge evidence hotfix"
```

### Task 4: Verify, publish, deploy, and resume R9

**Files:**
- No additional source files.

- [ ] **Step 1: Run the focused regression pool and smoke**

Run all commands from Tasks 2 and 3 fresh and record exact counts.

- [ ] **Step 2: Run DevGate and light evaluator**

Run the repository's applicable DevGate scripts. The sprint has no new delivery
contract, so light evaluator may report its documented no-BEHAVIOR exemption;
it must not report a failure.

- [ ] **Step 3: Push and open an independent hotfix PR**

The PR body includes root cause, Red→Green SHAs, tests, and the fact that
#4317's delivery diff remains untouched.

- [ ] **Step 4: Require GitHub rollup green and merge**

Do not merge while any check is pending or failing.

- [ ] **Step 5: Deploy and verify health**

Verify `/api/brain/health` reports the new version and a deployed SHA descended
from the hotfix merge.

- [ ] **Step 6: Resume the same R9 run**

Use task/run APIs and the documented kernel CLI if recovery is needed. The
independent judge must PASS before creating the merge-gate review.

- [ ] **Step 7: Use the authenticated approval route and finish**

Approve the merge-gate request already authorized by the user, let the kernel
merge/report chain complete, and verify task/run/PR terminal state.
