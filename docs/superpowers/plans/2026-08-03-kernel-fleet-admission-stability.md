# Kernel Fleet Admission Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove false Fleet admission failures caused by the duplicated 40 GiB disk floor and a single-attempt PostgreSQL cold-start probe.

**Architecture:** Keep all resource policy in NodeProfile, pass the disk floor into installer preflight, and bound PostgreSQL runtime retries inside `node-probe.cjs`. Every permanent failure remains fail-closed.

**Tech Stack:** Node.js 25, Bash, Vitest, JSON NodeProfile registry, macOS LaunchDaemon/OrbStack Docker.

---

### Task 1: Make PostgreSQL runtime admission resilient

**Files:**
- Modify: `packages/brain/scripts/fleet-worker/fleet-worker.test.js`
- Modify: `packages/brain/scripts/fleet-worker/node-probe.cjs`

- [ ] Add a Vitest case whose first pinned PostgreSQL `docker run` throws and whose second succeeds; assert `available: true`, two runs, and exact cleanup.
- [ ] Run `cd packages/brain && npx vitest run scripts/fleet-worker/fleet-worker.test.js`; expect the new case to fail because only one run occurs.
- [ ] Add a three-attempt loop around the exact disposable PostgreSQL probe, preserving cleanup before and after every attempt.
- [ ] Rerun the test and verify both transient recovery and permanent-failure coverage pass.

### Task 2: Make NodeProfile the disk-floor SSOT

**Files:**
- Modify: `packages/brain/config/fleet-node-profiles.json`
- Modify: `packages/brain/src/orchestrator/fleet-node/node-profile.js`
- Modify: `packages/brain/src/orchestrator/fleet-node/node-profile.test.js`
- Modify: `packages/brain/src/orchestrator/fleet-node/node-admission.test.js`
- Modify: `packages/brain/scripts/fleet-worker/install-fleet-worker.sh`
- Modify: `packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh`

- [ ] Change test fixtures to require `disk_min_free_gib: 10` and add an installer assertion that no `40 * GIB` hardcode remains.
- [ ] Run the focused Vitest and Bash contract tests; expect failures against the 40 GiB implementation.
- [ ] Change the canonical registry/profile floor to 10 GiB, load it in the installer from NodeProfile, validate it as a positive integer, and compare the report against the passed value.
- [ ] Rerun focused tests; expect all profile, admission, probe, and installer contracts to pass.

### Task 3: Version, verify, publish, and redeploy

**Files:**
- Modify: `packages/brain/DEFINITION.md`
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json` if the repository version script updates it

- [ ] Bump Brain from `1.267.187` to the next patch and document disk-policy SSOT plus bounded PostgreSQL retries in `DEFINITION.md`.
- [ ] Run all focused tests, Engine tests, smoke allowlist checks, and `git diff --check`.
- [ ] Commit, push the isolated branch, open the hotfix PR, review current-head CI, and squash merge only when every required check is green.
- [ ] Confirm Gate3 reports the merged SHA/version while Tick remains disabled.
- [ ] Bootstrap and admit US M4, Xian M4, and Xian M1; verify exact pinned images and system LaunchDaemon health before the real two-phase protocol probe.
