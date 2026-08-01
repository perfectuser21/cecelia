# Fleet Worker Tailscale URL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the production Brain container can always resolve and reach the Xian M4 and M1 Fleet Workers after a compose recreate.

**Architecture:** Keep the existing environment override contract, but replace the two non-resolvable Docker DNS hostname defaults with the fixed Tailscale IPs already owned by the signed Fleet NodeProfiles. Protect the deployment contract with a source-level Vitest that rejects the old hostname defaults.

**Tech Stack:** Docker Compose, Tailscale networking, Node.js, Vitest

---

### Task 1: Pin resolvable Xian Fleet Worker defaults

**Files:**
- Modify: `scripts/__tests__/compose-project-isolation.test.sh`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Write the failing deployment-contract test**

Add a test that requires `FLEET_WORKER_XIAN_MAC_M4_URL` to default to `http://100.86.57.69:5231`, requires `FLEET_WORKER_XIAN_MAC_M1_URL` to default to `http://100.88.166.55:5231`, and rejects the former `xian-mac-m4` / `xian-mac-m1` hostname defaults.

- [ ] **Step 2: Run the focused test to verify Red**

Run: `bash scripts/__tests__/compose-project-isolation.test.sh`

Expected: FAIL because `docker-compose.yml` still defaults to the two unresolvable hostnames.

- [ ] **Step 3: Commit the Red test**

Run:

```bash
git add scripts/__tests__/compose-project-isolation.test.sh
git commit -m "test(fleet): guard resolvable worker defaults"
```

- [ ] **Step 4: Apply the minimal compose fix**

Change only the two Xian default URLs in `docker-compose.yml`; retain `${FLEET_WORKER_...:-...}` so operators can still override them.

- [ ] **Step 5: Run focused and compose verification to verify Green**

Run:

```bash
bash scripts/__tests__/compose-project-isolation.test.sh
CECELIA_TICK_ENABLED=false docker compose config --quiet
git diff --check
```

Expected: focused Vitest passes, compose configuration parses, and the diff has no whitespace errors.

- [ ] **Step 6: Commit the implementation**

Run:

```bash
git add docker-compose.yml
git commit -m "fix(fleet): use resolvable Xian worker URLs"
```

### Task 2: Ship and verify production admission

**Files:**
- No additional source files

- [ ] **Step 1: Push the `/dev` branch and open a `[CONFIG]` PR**

The PR body must declare `GP-Anchor: none(infra)` and include the live failure evidence, Red/Green commands, and the constraint that Brain Tick remains disabled.

- [ ] **Step 2: Wait for every latest PR check and merge with squash**

Expected: all latest checks are success or intentional skip; no failure or pending check remains.

- [ ] **Step 3: Recreate the production Brain with Tick disabled**

Run compose with `CECELIA_TICK_ENABLED=false`; confirm Brain version/SHA remain unchanged except for the newly deployed merge when deployment automation updates it, and confirm `HARNESS_REVIEW_APPROVER_TOKEN` is configured without printing its value.

- [ ] **Step 4: Verify all three Fleet Nodes with the production admission client**

Expected for `us-mac-m4`, `xian-mac-m4`, and `xian-mac-m1`: `state=base_admitted`, `base_admitted=true`, `dispatch_ready=true`, and an empty reasons array.
