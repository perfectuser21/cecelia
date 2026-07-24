# Review Preview Safe Port Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent `review-preview.sh` from killing OrbStack or any other process it does not own.

**Architecture:** Treat the per-port PID file as the sole ownership record. Remove the broad `lsof | kill -9` cleanup; let the existing server startup and readiness checks fail safely when an unrelated process owns the port.

**Tech Stack:** Bash, Node.js, Vitest

---

### Task 1: Add the ownership regression test

**Files:**
- Create: `packages/brain/src/__tests__/review-preview-process-ownership.test.js`

- [ ] **Step 1: Write the failing test**

Create a Vitest test that starts a real detached Node HTTP server on an unused
port outside `5300-5399`, removes the corresponding review PID file, runs the
real `scripts/review-preview.sh`, and asserts both that the script exits nonzero
and that the unrelated server remains alive.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd packages/brain
npx vitest run src/__tests__/review-preview-process-ownership.test.js
```

Expected: FAIL because the current script kills the unrelated listener and
starts its own preview.

- [ ] **Step 3: Commit the red test**

```bash
git add packages/brain/src/__tests__/review-preview-process-ownership.test.js
git commit -m "test(preview): reproduce broad port cleanup kill"
```

### Task 2: Remove broad process killing

**Files:**
- Modify: `scripts/review-preview.sh`

- [ ] **Step 1: Implement the minimal fix**

Delete:

```bash
# 也清掉占用同端口的其他进程
lsof -ti ":${PORT}" 2>/dev/null | xargs kill -9 2>/dev/null || true
```

Keep the existing PID-file-based old preview termination unchanged.

- [ ] **Step 2: Run the test to verify it passes**

Run:

```bash
cd packages/brain
npx vitest run src/__tests__/review-preview-process-ownership.test.js \
  src/__tests__/staging-e2e-runner-review-env-ssh.test.js
```

Expected: both files pass; the unrelated listener survives.

- [ ] **Step 3: Run DevGate**

Run:

```bash
bash scripts/devgate/devgate.sh
```

Expected: exit 0.

- [ ] **Step 4: Commit the fix**

```bash
git add scripts/review-preview.sh
git commit -m "fix(preview): only stop PID-file-owned server"
```

### Task 3: Publish and restore the fire drill

**Files:**
- No additional source files.

- [ ] **Step 1: Push and open the isolated hotfix PR**

Push `cp-07242143-review-preview-safe-port`, open a PR against `main`, and wait
for the GitHub check rollup to become all green.

- [ ] **Step 2: Merge and deploy**

Merge the hotfix through the PR, update production to the merged `main`, and
verify `/api/brain/health` remains healthy while a review preview is created.

- [ ] **Step 3: Resume the existing run**

Resume run `54c06682-2b2e-4a56-b2e7-ee85052c54ef` through the production
kernel entrypoint and verify it appends `effect:human_review_requested`.

- [ ] **Step 4: Use the authenticated approval endpoint**

Approve the exact request hop and current PR head through
`POST /api/brain/harness/kernel-reviews/:runId/approve`, then allow kernel
derive/dispatch to continue to its next gate. Never insert approval rows
directly.

