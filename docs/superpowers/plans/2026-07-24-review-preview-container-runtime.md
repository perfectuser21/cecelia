# Review Preview Container Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run review preview inside the Brain container so the existing Docker port mapping owns host exposure.

**Architecture:** Select the script root by runtime boundary: `/app` in a container and `CECELIA_HOST_REPO` on the host. Always invoke the selected script with local `bash`; keep the static dist argument on the mounted host-repo path.

**Tech Stack:** Node.js, Bash, Vitest, Docker

---

### Task 1: Change the runtime contract test

**Files:**
- Modify: `packages/brain/src/__tests__/staging-e2e-runner-review-env-ssh.test.js`

- [ ] Change `inContainer=true` and auto-detected container assertions from
  `ssh` to `bash`, and assert the script path is
  `/app/scripts/review-preview.sh`.
- [ ] Run the file and verify RED because production still calls `ssh`.
- [ ] Commit the red test.

### Task 2: Route container preview locally

**Files:**
- Modify: `packages/brain/src/staging-e2e-runner.js`
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `package-lock.json`
- Modify: `DEFINITION.md`
- Modify: `.brain-versions`

- [ ] Select `/app/scripts/review-preview.sh` when in a container.
- [ ] Select the host-repo script when not in a container.
- [ ] Invoke both paths with `spawnSync('bash', ...)`.
- [ ] Bump Brain from `1.267.68` to `1.267.69` in all ledgers.
- [ ] Run the targeted test and existing review-preview ownership test.
- [ ] Run Facts, version sync, and pre-push checks.
- [ ] Commit the implementation.

### Task 3: Publish, deploy, and recover

- [ ] Open an independent PR and require GitHub check rollup all green.
- [ ] Squash merge and verify production health is `1.267.69`.
- [ ] Let the queued fire-drill task create a fresh recovery run through the
  official tick/relay path.
- [ ] Verify `effect:human_review_requested`, use the authenticated approval
  endpoint, and allow the kernel to complete merge/report without direct DB
  mutation.

