# Fleet GitHub Read Broker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Kernel Evaluator and Reporter exact, audited PR facts without exposing GitHub credentials or `gh` execution to provider containers.

**Architecture:** Brain freezes a versioned read policy and remote transport copies it. Worker validates and observes the PR through an argv-only broker, journals a hash-chained receipt, and mounts the public authority file read-only. Runner verifies against that file instead of invoking `gh`.

**Tech Stack:** Node.js CommonJS/ESM, Zod, Vitest, `node:test`, Bash contract tests, Docker argv generation.

---

### Task 1: Freeze and transport the read policy

**Files:**
- Modify: `packages/brain/src/orchestrator/execution-contract.js`
- Modify: `packages/brain/src/orchestrator/dispatcher.js`
- Modify: `packages/brain/src/orchestrator/remote-bridge-transport.js`
- Test: `packages/brain/src/orchestrator/__tests__/execution-contract.test.js`
- Test: `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`
- Test: `packages/brain/src/orchestrator/remote-bridge-transport.test.js`

- [ ] Write failing tests for exact fields, evaluator/reporter applicability, canary exclusion, workspace binding, and transport copying.
- [ ] Run the three focused Vitest files and confirm failures identify the absent policy.
- [ ] Add `github-read/v1`, strict parsing/building, dispatcher freezing, and launch-request transport.
- [ ] Re-run focused tests and commit the green slice.

### Task 2: Implement the Worker read broker

**Files:**
- Create: `packages/brain/scripts/fleet-worker/github-read-broker.cjs`
- Create: `packages/brain/scripts/fleet-worker/github-read-broker.test.cjs`

- [ ] Write failing `node:test` cases for exact axes, argv-only invocation, output bounds/schema, mode-0600 journal, hash chain, replay, and corruption/conflict.
- [ ] Run the new test file and confirm module/behavior failures.
- [ ] Implement strict policy/fact parsing, `gh` adapter, append-only audit store, and idempotent observation.
- [ ] Re-run the broker tests and commit the green slice.

### Task 3: Integrate Worker launch and durable state

**Files:**
- Modify: `packages/brain/scripts/fleet-worker/attempt-runner.cjs`
- Modify: `packages/brain/scripts/fleet-worker/attempt-runner.test.cjs`
- Modify: `packages/brain/scripts/fleet-worker/fleet-worker.cjs`
- Test: `packages/brain/scripts/fleet-worker/fleet-worker.test.cjs`

- [ ] Replace the existing fail-closed placeholder tests with failing policy/broker/state/order tests.
- [ ] Confirm Evaluator and Reporter tests fail before integration.
- [ ] Validate policy at request ingress, observe before credential/workspace side effects, persist public authority, and inject the broker from Worker runtime.
- [ ] Re-run Worker tests and commit the green slice.

### Task 4: Replace Runner `gh` with read-only authority

**Files:**
- Modify: `docker/cecelia-runner/result-channel-driver.cjs`
- Modify: `docker/cecelia-runner/result-channel-driver.test.cjs`
- Modify: `docker/cecelia-runner/entrypoint.sh`
- Modify: `docker/cecelia-runner/entrypoint-managed-result-channel.test.sh`
- Modify: `packages/brain/scripts/fleet-worker/attempt-runner.cjs`
- Modify: `packages/brain/scripts/fleet-worker/attempt-runner.test.cjs`

- [ ] Write failing tests that production Runner resolution requires the authority file and cannot call `gh`.
- [ ] Write failing Docker argv tests for the fixed read-only file mount and credential/config absence.
- [ ] Implement strict file loading, fixed environment path, and a Worker-created bounded authority file mounted read-only.
- [ ] Run Runner, entrypoint, Docker adapter, and Worker tests; commit the green slice.

### Task 5: Install, rollout, documentation, and versions

**Files:**
- Modify: `packages/brain/scripts/fleet-worker/install-fleet-worker.sh`
- Modify: `packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh`
- Modify: `packages/brain/scripts/fleet-worker/fleet-rollout.sh`
- Modify: `packages/brain/scripts/fleet-worker/fleet-rollout.test.sh`
- Modify: `packages/workflows/skills/harness-evaluator/SKILL.md`
- Modify: `packages/workflows/skills/harness-report/SKILL.md`
- Modify: `packages/brain/DEFINITION.md`
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `package-lock.json`

- [ ] Write failing install/rollout assertions for the new broker and updated authority contract.
- [ ] Update install manifest/rollback and rollout archive inputs.
- [ ] Update Evaluator/Reporter instructions to consume frozen authority and prohibit direct GitHub CLI access.
- [ ] Bump Brain and Skill versions consistently, update DEFINITION, and run version checks.
- [ ] Commit the documentation/version slice.

### Task 6: Fresh verification

- [ ] Run all focused Brain contract tests.
- [ ] Run broker, Worker, Runner, entrypoint, install, and rollout tests.
- [ ] Run relevant lint/version/DevGate checks.
- [ ] Inspect `git diff --check`, status, and commit list.
- [ ] Report commits and exact fresh evidence without pushing, opening a PR, merging, or deploying.
