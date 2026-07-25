# Runner Proposer Finalizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deterministically commit and push complete Proposer contract artifacts when an LLM exits before the existing mandatory Git step.

**Architecture:** A provider-neutral shell function in the Runner validates server-injected paths, stages an exact artifact allowlist, pushes the injected branch, and canonicalizes the Proposer result before callback normalization. The existing Kernel observer remains the authority when finalization fails.

**Tech Stack:** Bash, Git, jq, Docker Runner contract tests

---

### Task 1: Proposer finalizer contract

**Files:**
- Modify: `docker/cecelia-runner/entrypoint-provider-contract.test.sh`
- Modify: `docker/cecelia-runner/entrypoint.sh`

- [ ] **Step 1: Write the failing real-Git contract test**

Extract the marked `proposer-finalizer` section, create a temporary repository with a
bare `origin`, populate a complete sprint, and call:

```bash
HARNESS_NODE=proposer \
CECELIA_TASK_ID=a1fa8636-2ad4-41b4-8de3-8609af83daec \
PROPOSE_BRANCH=cp-harness-propose-r1-a1fa8636-a4 \
SPRINT_DIR=sprints/07251915-kernel-a1fa8636 \
WORKTREE_PATH="$FINALIZER_REPO" \
finalize_proposer_output
```

Assert the remote branch contains all four artifact classes and `.brain-result.json`
contains the injected branch. Add negative cases for a mismatched task short id and a
missing contract artifact; neither may create a remote ref.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
bash docker/cecelia-runner/entrypoint-provider-contract.test.sh
```

Expected: FAIL with `missing proposer finalizer` or
`finalize_proposer_output: command not found`.

- [ ] **Step 3: Commit the Red test**

```bash
git add docker/cecelia-runner/entrypoint-provider-contract.test.sh
git commit -m "[Red] test(runner): reproduce proposer no-push exit"
```

- [ ] **Step 4: Implement the minimal finalizer**

Add `finalize_proposer_output` inside a marked section in `entrypoint.sh`. Validate the
authoritative branch and sprint path, require the exact artifacts, use
`git checkout -B`, exact-path `git add`, conditional `git commit`, non-force
`git push`, remote-ref verification, and atomic jq normalization of
`.brain-result.json`.

Call it after provider/session cleanup and before callback result normalization only when
`provider_exit == 0`. A finalizer failure must be logged but must not forge a successful
remote observation.

- [ ] **Step 5: Run focused verification and verify GREEN**

Run:

```bash
bash docker/cecelia-runner/entrypoint-provider-contract.test.sh
bash -n docker/cecelia-runner/entrypoint.sh
git diff --check
```

Expected: all exit 0.

- [ ] **Step 6: Commit the Green implementation**

```bash
git add docker/cecelia-runner/entrypoint.sh
git commit -m "[Green] fix(runner): finalize proposer contract push"
```

### Task 2: Publish and production canary

**Files:**
- No additional source files

- [ ] **Step 1: Push the branch and open a PR**

Push `cp-07252155-runner-proposer-finalizer`, open a PR to `main`, and include the
production run IDs, Red→Green commands, and fail-closed boundaries.

- [ ] **Step 2: Build a canary image from the exact Green commit**

```bash
docker build -t cecelia/runner:proposer-finalizer docker/cecelia-runner
```

Tag the canary as `cecelia/runner:latest` only after the local contract suite passes.

- [ ] **Step 3: Requeue telemetry task and verify the real boundary**

Requeue and dispatch task `a1fa8636-2ad4-41b4-8de3-8609af83daec`. Verify a Proposer
attempt that exits with complete local artifacts creates the server-injected remote
branch and advances to Reviewer without `gan_no_push_streak`.

- [ ] **Step 4: Merge only after all GitHub checks pass**

Confirm zero failing/pending required checks, merge the PR without bypassing checks, then
rebuild `cecelia/runner:latest` from the merge commit.

