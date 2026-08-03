# Fleet Offline PostgreSQL Tag Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Fleet bootstrap consume pinned Runner archives offline even when Docker records the PostgreSQL entry with `RepoTags: null`.

**Architecture:** Keep the repository-qualified PostgreSQL digest in NodeProfile and Worker contracts. The producer saves a verified local tag, while the consumer can reconstruct that exact tag from an already loaded and verified bare digest for backward compatibility.

**Tech Stack:** Bash, Docker/OrbStack, Node.js Fleet contracts, shell behavioral tests, GitHub Actions.

---

### Task 1: Reproduce the offline archive failure

**Files:**
- Modify: `packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.test.sh`
- Modify: `packages/brain/scripts/fleet-worker/fleet-rollout.test.sh`

- [ ] Split the fake Docker state into Runner content, PostgreSQL bare content, and PostgreSQL qualified-reference state. Make `docker load` create only the first two states, matching the production `RepoTags: null` archive.
- [ ] Assert that reconciliation must issue `docker image tag sha256:57c72... postgres:16-alpine` before the qualified digest can resolve.
- [ ] Assert that rollout must tag the qualified digest and pass `postgres:16-alpine` to `docker save`.
- [ ] Run both shell suites and verify they fail because the tag recovery/producer behavior is absent.
- [ ] Commit the Red tests as `test(kernel): expose offline Postgres tag loss`.

### Task 2: Recover and preserve the verified tag

**Files:**
- Modify: `packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.sh`
- Modify: `packages/brain/scripts/fleet-worker/fleet-rollout.sh`

- [ ] Add constants derived from the pinned value: bare digest `sha256:57c72...` and tag `postgres:16-alpine`.
- [ ] After archive load, if the qualified reference is absent, require the exact bare digest, tag it with the expected repository/tag, and require the qualified reference to resolve; otherwise fail closed with `postgres_image_unavailable`.
- [ ] Before creating a new archive, tag the verified qualified image and save the tag rather than the digest-qualified reference.
- [ ] Run both shell suites and verify Green.
- [ ] Commit as `fix(kernel): recover pinned Postgres tag offline`.

### Task 3: Synchronize production versions and definitions

**Files:**
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/config/fleet-node-profiles.json`
- Modify: `packages/brain/src/orchestrator/fleet-node/node-profile.js`
- Modify: `packages/brain/DEFINITION.md`
- Modify: `DEFINITION.md`
- Modify: `package-lock.json`
- Modify: `packages/brain/package-lock.json`

- [ ] Bump Brain `1.267.189` to `1.267.190` and Fleet Worker `1.267.94` to `1.267.95` in all SSOT/definition locations.
- [ ] Add rollback text pointing to Brain `1.267.189` / Worker `1.267.94` and the drain fail-closed behavior.
- [ ] Synchronize lockfiles using the repository package manager command.
- [ ] Run version/governance smoke and both Fleet suites.
- [ ] Commit as `chore(brain): version offline Postgres recovery`.

### Task 4: Verify, review, and merge

**Files:**
- Verify all modified files and CI configuration; no new production files.

- [ ] Run `git diff --check`, both Fleet shell suites, Fleet Node/Profile/Admission tests, GP governance/version smoke, and the assertion-command smoke.
- [ ] Re-run Red/Green proof by temporarily checking the test commit without the implementation or by using the committed Red SHA in a clean worktree.
- [ ] Push the branch, open a PR, inspect every GitHub check, fix any failure, and request/perform code review.
- [ ] Squash merge only after all latest checks pass; record the exact merge SHA.

### Task 5: Roll out and prove the real path

**Files:**
- Operational staging only; no repository edits.

- [ ] Verify production Brain deploys the exact merge SHA and remains Tick-off.
- [ ] Deliver only the new source tar and incremental bundle to both Xian nodes; reuse the already verified Runner tar and protected Worker token.
- [ ] Run `drain -> bootstrap` on Xian M4 and M1 with no manual TMPDIR override; verify LaunchDaemon, exact repository SHA, pinned Runner/PostgreSQL runtime, disk/memory/Docker/Git/callback checks, capacity, and drain.
- [ ] Explicitly undrain/admit only after health passes, then run the real two-phase Kernel protocol probe.
- [ ] Run the full real Kernel Harness on PR #1581 exact SHA through Reviewer, Generator, Evaluator, Independent Judge, and Reporter; do not merge the business PR without fresh exact-SHA attestations.
